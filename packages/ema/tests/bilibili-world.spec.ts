import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  BilibiliWorld,
  BilibiliRateLimitError,
  BilibiliContentFilterError,
  type EmaCtx,
  type EmaActor,
  type EmaWorldRegistry,
  type BilibiliLiveRawEvent,
  type BilibiliRawComment,
  type BilibiliRawDm,
} from "../src/index.js";

describe("BilibiliWorld - RFC-0001 Architecture & Invariants", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let registryMap: Map<string, unknown>;
  let registry: EmaWorldRegistry;
  let ctx: EmaCtx;
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const mockActor: EmaActor = {
    id: "actor-ema-companion",
    name: "Ema Companion",
    session: "session-2026-11-08-bili-test",
    agentId: "emafanclub_ema_dev",
  };

  beforeEach(() => {
    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
    registryMap = new Map();
    registry = {
      register: (name, world) => {
        registryMap.set(name, world);
        return {
          dispose: () => {
            registryMap.delete(name);
          },
        };
      },
      get: (name) => registryMap.get(name) as any,
      list: () =>
        [...registryMap.entries()].map(([name, world]) => ({ name, world: world as any })),
    };
    ctx = { router, inputBatcher, registry };
  });

  describe("Lifecycle & Router Mounting", () => {
    it("registers with registry and mounts endpoints under /world/bilibili", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456", "room:789012"],
        videoTargets: ["BV1xx411c7mD", "opus:998877"],
        dmTargets: ["1001", "dm:1002"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      expect(registry.get("bilibili")).toBe(world);

      // 1. World overview
      const overview = await router.read<{ world: string; parts: Array<{ id: string }> }>(
        "/world/bilibili",
      );
      expect(overview.world).toBe("bilibili");
      expect(overview.parts.length).toBe(7);

      // 2. Parts listing
      const partsRes = await router.read<{ world: string; parts: Array<{ id: string; type: string }> }>(
        "/world/bilibili/parts",
      );
      expect(partsRes.parts.map((p) => p.id)).toEqual([
        "room:123456",
        "room:789012",
        "video:BV1xx411c7mD",
        "opus:998877",
        "dm:1001",
        "dm:1002",
        "dynamic",
      ]);

      // 3. Single part inspection
      const roomPart = await router.read<{ id: string; type: string; name: string }>(
        "/world/bilibili/parts/room:123456",
      );
      expect(roomPart.id).toBe("room:123456");
      expect(roomPart.type).toBe("room");

      // 4. Status endpoint
      const status = await router.read<{
        world: string;
        active: boolean;
        rooms: string[];
        videoTargets: string[];
        dmTargets: string[];
      }>("/world/bilibili/status");
      expect(status.world).toBe("bilibili");
      expect(status.active).toBe(true);
      expect(status.rooms).toEqual(["123456", "789012"]);
      expect(status.videoTargets).toEqual(["video:BV1xx411c7mD", "opus:998877"]);
      expect(status.dmTargets).toEqual(["1001", "1002"]);

      handle.dispose();

      // Disposed world routes return 404
      await expect(router.read("/world/bilibili/parts")).rejects.toThrow("Route not found");
      expect(registry.get("bilibili")).toBeUndefined();
    });

    it("throws 404 for nonexistent part", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      await expect(router.read("/world/bilibili/parts/room:999999")).rejects.toThrow(
        "Part not found",
      );

      handle.dispose();
    });
  });

  describe("Inbound Live Streaming Danmaku & Interaction Ingestion", () => {
    it("ingests Danmaku (DANMU_MSG) and pushes normalized EmaInput to batcher", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        ownerUid: "999000",
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const pushedInputs: unknown[] = [];
      inputBatcher.onBatch((batch) => {
        pushedInputs.push(...batch);
      });

      // Regular user danmaku
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: {
          msgId: "danmaku-101",
          uid: "1001",
          uname: "Alice",
          msg: "Hello EMA Companion!",
          timestamp: 1700000000000,
          color: 16777215,
          fontSize: 25,
        },
      });

      // Owner user danmaku
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: {
          msgId: "danmaku-102",
          uid: "999000",
          uname: "Master",
          msg: "System check from creator",
          timestamp: 1700000001000,
        },
      });

      // Flush batcher
      const emitted = await inputBatcher.flush();
      expect(emitted.length).toBe(2);

      const first = emitted[0];
      expect(first.world).toBe("bilibili");
      expect(first.partId).toBe("room:123456");
      expect(first.content).toBe("Hello EMA Companion!");
      expect(first.sender.id).toBe("user:1001");
      expect(first.sender.name).toBe("Alice");
      expect(first.sender.isOwner).toBe(false);
      expect(first.metadata?.type).toBe("danmaku");

      const second = emitted[1];
      expect(second.sender.id).toBe("user:999000");
      expect(second.sender.isOwner).toBe(true);

      // Verify router lookup for individual message
      const queriedMsg = await router.read<{ id: string; content: string }>(
        "/world/bilibili/messages/danmaku-101",
      );
      expect(queriedMsg.id).toBe("danmaku-101");
      expect(queriedMsg.content).toBe("Hello EMA Companion!");

      // Verify router danmaku history query
      const danmakuHistory = await router.read<{ roomId: string; count: number }>(
        "/world/bilibili/danmaku/123456",
      );
      expect(danmakuHistory.roomId).toBe("123456");
      expect(danmakuHistory.count).toBe(2);

      handle.dispose();
    });

    it("ingests Gifts, SuperChats, and Guard purchases with metadata", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Gift event
      world.emitLiveEvent("123456", {
        cmd: "SEND_GIFT",
        data: {
          giftId: 10001,
          giftName: "B-Clap",
          num: 10,
          uname: "Sakura",
          uid: "2001",
          price: 1000,
        },
      });

      // SuperChat event
      world.emitLiveEvent("123456", {
        cmd: "SUPER_CHAT_MESSAGE",
        data: {
          id: 5544,
          uid: "2002",
          uname: "Bob",
          price: 50,
          message: "Keep up the great work with EMA!",
        },
      });

      // Guard purchase event
      world.emitLiveEvent("123456", {
        cmd: "GUARD_BUY",
        data: {
          uid: "2003",
          uname: "Charlie",
          guardLevel: 3,
          guardName: "舰长",
          num: 1,
        },
      });

      const emitted = await inputBatcher.flush();
      expect(emitted.length).toBe(3);

      // Gift verification
      expect(emitted[0].content).toContain("[GIFT] Sakura 赠送了 B-Clap x10");
      expect(emitted[0].metadata?.type).toBe("gift");
      expect(emitted[0].metadata?.giftName).toBe("B-Clap");

      // SuperChat verification
      expect(emitted[1].content).toContain("[SUPERCHAT ¥50] Keep up the great work with EMA!");
      expect(emitted[1].metadata?.type).toBe("superchat");
      expect(emitted[1].metadata?.price).toBe(50);

      // Guard verification
      expect(emitted[2].content).toContain("[GUARD] Charlie 开通了 舰长 x1");
      expect(emitted[2].metadata?.type).toBe("guard");
      expect(emitted[2].metadata?.guardLevel).toBe(3);

      handle.dispose();
    });

    it("filters automated entry notices and spam keywords", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        filterEntryNotices: true,
        spamKeywords: ["刷屏", "买粉"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Entry notices should be filtered
      world.emitLiveEvent("123456", {
        cmd: "INTERACT_WORD",
        data: { uid: "3001", uname: "Passerby" },
      });
      world.emitLiveEvent("123456", {
        cmd: "ENTRY_EFFECT",
        data: { uid: "3002", uname: "VIP" },
      });

      // Spam keywords should be filtered
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { uid: "3003", uname: "Spammer", msg: "专业代练买粉看主页" },
      });

      // Valid message should pass
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { uid: "3004", uname: "RealFan", msg: "主播晚上好！" },
      });

      const emitted = await inputBatcher.flush();
      expect(emitted.length).toBe(1);
      expect(emitted[0].content).toBe("主播晚上好！");

      handle.dispose();
    });

    it("suppresses sliding duplicate barrage bursts within 5 seconds", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Same sender sending identical text in rapid succession
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { msgId: "burst-1", uid: "4001", uname: "FanA", msg: "66666" },
      });
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { msgId: "burst-2", uid: "4001", uname: "FanA", msg: "66666" },
      });
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { msgId: "burst-3", uid: "4002", uname: "FanB", msg: "66666" }, // different user
      });

      const emitted = await inputBatcher.flush();
      expect(emitted.length).toBe(2); // FanA once, FanB once
      expect(emitted.map((e) => e.sender.name)).toEqual(["FanA", "FanB"]);

      handle.dispose();
    });
  });

  describe("Video Comment & DM Polling Ingestion", () => {
    it("polls video comments and fan DMs via custom fetchers", async () => {
      const mockComments: BilibiliRawComment[] = [
        {
          rpid: 101,
          uid: 5001,
          uname: "Commenter1",
          message: "Great episode analysis!",
          timestamp: 1700000010000,
        },
        {
          rpid: 102,
          uid: 5002,
          uname: "Commenter2",
          message: "Agree with the points",
          parentRpid: 101,
          timestamp: 1700000015000,
        },
      ];

      const mockDms: BilibiliRawDm[] = [
        {
          msgId: 9001,
          mid: 6001,
          uname: "FanPrivate",
          content: "Can you review my video script?",
          timestamp: 1700000020000,
        },
      ];

      const world = new BilibiliWorld({
        videoTargets: ["video:BV1xx411c7mD"],
        dmTargets: ["dm:6001"],
        dbPath: ":memory:",
        passive: true,
        commentFetcher: vi.fn().mockResolvedValue(mockComments),
        dmFetcher: vi.fn().mockResolvedValue(mockDms),
        env: mockEnv,
      });

      const handle = world.start(ctx);

      await world.pollComments();
      await world.pollDms();

      const emitted = await inputBatcher.flush();
      expect(emitted.length).toBe(3);

      // Verify comment
      const comment1 = emitted.find((e) => e.id.includes("101"));
      expect(comment1?.partId).toBe("video:BV1xx411c7mD");
      expect(comment1?.content).toBe("Great episode analysis!");

      // Verify reply comment
      const comment2 = emitted.find((e) => e.id.includes("102"));
      expect(comment2?.replyTo).toBe("bili-comment-video:BV1xx411c7mD-101");

      // Verify DM
      const dm = emitted.find((e) => e.id.includes("9001"));
      expect(dm?.partId).toBe("dm:6001");
      expect(dm?.content).toBe("Can you review my video script?");

      // Verify router querying comments and DMs
      const queriedComments = await router.read<{ targetId: string; count: number }>(
        "/world/bilibili/comments/video:BV1xx411c7mD",
      );
      expect(queriedComments.count).toBe(2);

      const queriedDms = await router.read<{ mid: string; count: number }>(
        "/world/bilibili/dms/6001",
      );
      expect(queriedDms.count).toBe(1);

      handle.dispose();
    });
  });

  describe("Transactional Input Batching & XML Trigger Formatting", () => {
    it("coalesces burst inputs from live room into atomic XML payload", async () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { msgId: "xml-1", uid: "7001", uname: "Sakura<Fan>", msg: "Hello <World> & Everyone!" },
      });
      world.emitLiveEvent("123456", {
        cmd: "DANMU_MSG",
        data: { msgId: "xml-2", uid: "7001", uname: "Sakura<Fan>", msg: "Next line!" },
      });

      const batch = await inputBatcher.flush();
      expect(batch.length).toBe(2);

      const xml = formatBatchToXml(batch);
      expect(xml).toContain("<Input>");
      expect(xml).toContain("<World>bilibili</World>");
      expect(xml).toContain("<Channel>room:123456</Channel>");
      expect(xml).toContain("<Name>Sakura&lt;Fan&gt;</Name>");
      expect(xml).toContain('<Message id="xml-1">Hello &lt;World&gt; &amp; Everyone!</Message>');
      expect(xml).toContain('<Message id="xml-2">Next line!</Message>');
      expect(xml).toContain("</Input>");

      handle.dispose();
    });
  });

  describe("Outbound Action Dispatcher (Live Room, Comments, DMs)", () => {
    it("dispatches live room Danmaku broadcasts and records dispatches", async () => {
      const dispatchedDanmaku: Array<{ roomId: string; message: string; options?: unknown }> = [];

      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        danmakuSender: (roomId, message, options) => {
          dispatchedDanmaku.push({ roomId, message, options });
        },
        env: mockEnv,
      });

      const handle = world.start(ctx);

      world.interact(ctx, mockActor, "room:123456", "danmaku", "Hello room 123456!");
      expect(dispatchedDanmaku.length).toBe(1);
      expect(dispatchedDanmaku[0].roomId).toBe("123456");
      expect(dispatchedDanmaku[0].message).toBe("Hello room 123456!");

      // Dispatches inspection via router
      const dispatches = await router.read<{ count: number; dispatches: Array<{ action: string; message: string }> }>(
        "/world/bilibili/dispatches",
      );
      expect(dispatches.count).toBe(1);
      expect(dispatches.dispatches[0].action).toBe("danmaku");
      expect(dispatches.dispatches[0].message).toBe("Hello room 123456!");

      handle.dispose();
    });

    it("formats thank-you greetings for gifts, SuperChats, and Guards", () => {
      const dispatchedDanmaku: string[] = [];

      const world = new BilibiliWorld({
        rooms: ["123456"],
        rateLimits: { danmakuMinIntervalMs: 0 },
        dbPath: ":memory:",
        passive: true,
        danmakuSender: (_roomId, message) => {
          dispatchedDanmaku.push(message);
        },
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // 1. Thank Gift
      world.interact(ctx, mockActor, "room:123456", "thank_gift", {
        uname: "Alice",
        giftName: "辣条",
        num: 5,
      });
      expect(dispatchedDanmaku[0]).toBe("感谢 Alice 赠送的 辣条 x5！");

      // 2. Thank SuperChat
      world.interact(ctx, mockActor, "room:123456", "thank_superchat", {
        uname: "Bob",
        price: 100,
        message: "加油！",
      });
      expect(dispatchedDanmaku[1]).toBe("感谢 Bob 的醒目留言（¥100）：加油！");

      // 3. Thank Guard
      world.interact(ctx, mockActor, "room:123456", "thank_guard", {
        uname: "Charlie",
        guardLevel: 2,
        guardName: "提督",
      });
      expect(dispatchedDanmaku[2]).toBe("热烈欢迎 Charlie 加入大航海（提督）！");

      handle.dispose();
    });

    it("dispatches video comments and fan DMs", () => {
      const dispatchedComments: Array<{ targetId: string; message: string }> = [];
      const dispatchedDms: Array<{ mid: string; message: string }> = [];

      const world = new BilibiliWorld({
        videoTargets: ["video:BV1xx411c7mD"],
        dmTargets: ["dm:1001"],
        dbPath: ":memory:",
        passive: true,
        commentSender: (targetId, message) => {
          dispatchedComments.push({ targetId, message });
        },
        dmSender: (mid, message) => {
          dispatchedDms.push({ mid, message });
        },
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // Video comment reply
      world.interact(ctx, mockActor, "video:BV1xx411c7mD", "comment", "Thank you for the review!");
      expect(dispatchedComments.length).toBe(1);
      expect(dispatchedComments[0].targetId).toBe("video:BV1xx411c7mD");
      expect(dispatchedComments[0].message).toBe("Thank you for the review!");

      // Fan DM reply
      world.interact(ctx, mockActor, "dm:1001", "dm", "Hello fan, thank you for writing!");
      expect(dispatchedDms.length).toBe(1);
      expect(dispatchedDms[0].mid).toBe("1001");
      expect(dispatchedDms[0].message).toBe("Hello fan, thank you for writing!");

      handle.dispose();
    });
  });

  describe("Safety & Guardrails: Banned Words and Anti-Flooding Rate Limiting", () => {
    it("rejects outbound messages containing banned words by default", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        bannedWords: ["违规内容", "涉黄涉赌"],
        bannedWordAction: "reject",
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      expect(() => {
        world.interact(ctx, mockActor, "room:123456", "danmaku", "包含涉黄涉赌的信息");
      }).toThrow(BilibiliContentFilterError);

      handle.dispose();
    });

    it("masks banned words when bannedWordAction is 'mask'", () => {
      let dispatched = "";
      const world = new BilibiliWorld({
        rooms: ["123456"],
        bannedWords: ["敏感词"],
        bannedWordAction: "mask",
        danmakuSender: (_room, msg) => {
          dispatched = msg;
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      world.interact(ctx, mockActor, "room:123456", "danmaku", "这是一个敏感词测试");
      expect(dispatched).toBe("这是一个***测试");

      handle.dispose();
    });

    it("enforces Danmaku minimum interval and maximum rate per minute", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        rateLimits: {
          danmakuMinIntervalMs: 500,
          danmakuMaxPerMinute: 2,
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // First danmaku succeeds
      world.interact(ctx, mockActor, "room:123456", "danmaku", "Msg 1");

      // Immediate second danmaku throws minimum interval error
      expect(() => {
        world.interact(ctx, mockActor, "room:123456", "danmaku", "Msg 2");
      }).toThrow(BilibiliRateLimitError);

      handle.dispose();
    });

    it("enforces comment and DM minimum intervals", () => {
      const world = new BilibiliWorld({
        videoTargets: ["video:BV1xx411c7mD"],
        dmTargets: ["dm:1001"],
        rateLimits: {
          commentMinIntervalMs: 1000,
          dmMinIntervalMs: 1000,
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // Comment rate limit
      world.interact(ctx, mockActor, "video:BV1xx411c7mD", "comment", "Comment 1");
      expect(() => {
        world.interact(ctx, mockActor, "video:BV1xx411c7mD", "comment", "Comment 2");
      }).toThrow(BilibiliRateLimitError);

      // DM rate limit
      world.interact(ctx, mockActor, "dm:1001", "dm", "DM 1");
      expect(() => {
        world.interact(ctx, mockActor, "dm:1001", "dm", "DM 2");
      }).toThrow(BilibiliRateLimitError);

      handle.dispose();
    });
  });

  describe("Local Content Filter & Host Privacy Guardrails", () => {
    it("rejects outbound messages containing local host file paths by default", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      const pathSamples = [
        "Please check /home/rei/repos/EverMemoryArchive/secret.txt",
        "Sensitive file at /etc/shadow",
        "Windows path C:\\Users\\Administrator\\Desktop\\token.txt",
        "Config in .vault.toml needs attention",
        "Leaked .env.production secrets",
        "SSH key in ~/.ssh/id_rsa",
      ];

      for (const sample of pathSamples) {
        expect(() => {
          world.interact(ctx, mockActor, "room:123456", "danmaku", sample);
        }).toThrow(BilibiliContentFilterError);
      }

      handle.dispose();
    });

    it("rejects outbound messages containing localhost or private network addresses by default", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      const hostSamples = [
        "API running on http://127.0.0.1:8080/api",
        "Debug portal: http://localhost:3000",
        "Internal node 192.168.1.100:9000",
      ];

      for (const sample of hostSamples) {
        expect(() => {
          world.interact(ctx, mockActor, "room:123456", "danmaku", sample);
        }).toThrow(BilibiliContentFilterError);
      }

      handle.dispose();
    });

    it("rejects outbound messages containing API credentials, tokens, or secrets by default", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      const secretSamples = [
        "OpenAI key is sk-proj-1234567890abcdef123456",
        "GitHub token ghp_123456789012345678901234567890",
        "Bilibili cookie SESSDATA=1234567890abcdef12345678",
        "CSRF token bili_jct=1234567890abcdef1234567890abcdef",
        "Auth header Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "Database password: my_super_secret_pw",
      ];

      for (const sample of secretSamples) {
        expect(() => {
          world.interact(ctx, mockActor, "room:123456", "danmaku", sample);
        }).toThrow(BilibiliContentFilterError);
      }

      handle.dispose();
    });

    it("rejects outbound messages containing harness system markers by default", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      const markerSamples = [
        "[context_summary] Here is earlier context",
        "Turn aborted: [turn_aborted] please resume",
        "Stored under <app_data_dir>/agents",
        "Session ID session-2026-11-08-12-23-01-dae71a22 active",
        "Invoking call:default_api:exec_command now",
      ];

      for (const sample of markerSamples) {
        expect(() => {
          world.interact(ctx, mockActor, "room:123456", "danmaku", sample);
        }).toThrow(BilibiliContentFilterError);
      }

      handle.dispose();
    });

    it("masks local machine sensitive content when contentFilter action is 'mask'", () => {
      let dispatched = "";
      const world = new BilibiliWorld({
        rooms: ["123456"],
        contentFilter: { action: "mask" },
        danmakuSender: (_room, msg) => {
          dispatched = msg;
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      world.interact(
        ctx,
        mockActor,
        "room:123456",
        "danmaku",
        "Check /home/rei/file.txt at http://localhost:8080 with sk-12345678901234567890 [context_summary]",
      );

      expect(dispatched).toBe(
        "Check [redacted] at [redacted] with [redacted] [redacted]",
      );

      handle.dispose();
    });

    it("supports selective filter toggling via contentFilter options", () => {
      let dispatched = "";
      // Allow local paths, but still filter secrets
      const world = new BilibiliWorld({
        rooms: ["123456"],
        contentFilter: {
          filterLocalPaths: false,
          filterSecrets: true,
        },
        danmakuSender: (_room, msg) => {
          dispatched = msg;
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // Local path is allowed because filterLocalPaths: false
      world.interact(ctx, mockActor, "room:123456", "danmaku", "Path is /home/rei/test.txt");
      expect(dispatched).toBe("Path is /home/rei/test.txt");

      // Secrets are still rejected
      expect(() => {
        world.interact(ctx, mockActor, "room:123456", "danmaku", "Token sk-12345678901234567890");
      }).toThrow(BilibiliContentFilterError);

      handle.dispose();
    });

    it("allows disabling contentFilter entirely when set to false or enabled: false", () => {
      let dispatched = "";
      const world = new BilibiliWorld({
        rooms: ["123456"],
        contentFilter: false,
        danmakuSender: (_room, msg) => {
          dispatched = msg;
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      world.interact(
        ctx,
        mockActor,
        "room:123456",
        "danmaku",
        "Host http://localhost:3000 at /tmp/test",
      );
      expect(dispatched).toBe("Host http://localhost:3000 at /tmp/test");

      handle.dispose();
    });

    it("applies local content filter across video comments, DMs, and feed dynamics", () => {
      const world = new BilibiliWorld({
        videoTargets: ["video:BV1xx411c7mD"],
        dmTargets: ["dm:1001"],
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // Comment rejected for local path
      expect(() => {
        world.interact(ctx, mockActor, "video:BV1xx411c7mD", "comment", "Look at /etc/passwd");
      }).toThrow(BilibiliContentFilterError);

      // DM rejected for secret token
      expect(() => {
        world.interact(ctx, mockActor, "dm:1001", "dm", "Here is ghp_123456789012345678901234567890");
      }).toThrow(BilibiliContentFilterError);

      // Feed dynamic rejected for system marker
      expect(() => {
        world.interact(ctx, mockActor, "dynamic", "post", "Test [turn_aborted] dynamic");
      }).toThrow(BilibiliContentFilterError);

      handle.dispose();
    });

    it("permits harmless fan-facing messages with Bilibili URLs, BVIDs, and emojis", () => {
      let dispatched = "";
      const world = new BilibiliWorld({
        rooms: ["123456"],
        danmakuSender: (_room, msg) => {
          dispatched = msg;
        },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      const safeMessage =
        "【EverMemoryArchive】Ema 伴侣系统运行测试：记忆归档与动态感知连接正常 ✨ https://www.bilibili.com/video/BV1xx411c7mD";
      world.interact(ctx, mockActor, "room:123456", "danmaku", safeMessage);
      expect(dispatched).toBe(safeMessage);

      handle.dispose();
    });
  });

  describe("RFC-0001 Invariants & Security", () => {
    it("refuses interact without operating agent identity (assertAgentIdentity)", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        env: { PENGUIN_AGENT_ID: "" },
      });

      expect(() => {
        world.interact(ctx, mockActor, "room:123456", "danmaku", "test");
      }).toThrow("refusing to dispatch without an agent identity");
    });

    it("refuses interact without verified EmaActor credentials (authenticated-actor-interaction)", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        env: mockEnv,
      });

      expect(() => {
        world.interact(ctx, null as any, "room:123456", "danmaku", "test");
      }).toThrow("Invalid or unauthenticated EmaActor credentials");
    });

    it("safely handles rejected promise from async danmakuSender without unhandled rejection", async () => {
      const mockSender = vi.fn().mockRejectedValue(new Error("Bilibili Danmaku gateway timeout"));
      const world = new BilibiliWorld({
        rooms: ["123456"],
        danmakuSender: mockSender,
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      expect(() => {
        world.interact(ctx, mockActor, "room:123456", "danmaku", "error test");
      }).not.toThrow();

      // Give event loop tick to verify no unhandled rejection terminates the process
      await new Promise((resolve) => setTimeout(resolve, 20));

      handle.dispose();
    });

    it("dispatches dynamic feed posts via dynamicSender when target is dynamic or action is post_dynamic", async () => {
      const mockDynamicSender = vi.fn().mockResolvedValue({
        success: true,
        dynamicId: "1268371909155749890",
        url: "https://t.bilibili.com/1268371909155749890",
      });

      const world = new BilibiliWorld({
        rooms: ["123456"],
        dynamicSender: mockDynamicSender,
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      const handle = world.start(ctx);

      // Method 1: interact with target "dynamic"
      world.interact(ctx, mockActor, "dynamic", "post", "Hello from Ema Dynamic");
      expect(mockDynamicSender).toHaveBeenCalledWith("Hello from Ema Dynamic", expect.anything());

      // Method 2: interact with action "post_dynamic"
      mockDynamicSender.mockClear();
      const world2 = new BilibiliWorld({
        rooms: ["123456"],
        dynamicSender: mockDynamicSender,
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });
      world2.interact(ctx, mockActor, "feed", "post_dynamic", "Second dynamic test");
      expect(mockDynamicSender).toHaveBeenCalledWith("Second dynamic test", expect.anything());

      handle.dispose();
      world2.dispose();
    });

    it("enforces dynamicMinIntervalMs rate limit on rapid dynamic posts", () => {
      const mockDynamicSender = vi.fn().mockResolvedValue({ success: true });
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dynamicSender: mockDynamicSender,
        rateLimits: { dynamicMinIntervalMs: 15000 },
        dbPath: ":memory:",
        passive: true,
        env: mockEnv,
      });

      world.start(ctx);

      // First post succeeds
      world.interact(ctx, mockActor, "dynamic", "post", "First dynamic");
      expect(mockDynamicSender).toHaveBeenCalledTimes(1);

      // Immediate second post throws BilibiliRateLimitError
      expect(() => {
        world.interact(ctx, mockActor, "dynamic", "post", "Immediate second dynamic");
      }).toThrow(BilibiliRateLimitError);

      world.dispose();
    });

    it("closes SQLite database on teardown", () => {
      const world = new BilibiliWorld({
        rooms: ["123456"],
        dbPath: ":memory:",
        env: mockEnv,
      });

      expect(typeof world.dispose).toBe("function");
      world.dispose();

      const db = (world as unknown as { db: unknown }).db;
      expect(db).toBeNull();
    });
  });
});
