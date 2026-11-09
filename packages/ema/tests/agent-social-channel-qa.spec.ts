import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  BilibiliWorld,
  PenguinChannelWorld,
  formatAgentRelativeTime,
  BilibiliContentFilterError,
  BilibiliRateLimitError,
  type EmaCtx,
  type EmaActor,
  type EmaWorldRegistry,
  type BilibiliChannel,
  type EmaNode,
  type EmaChannelItem,
  type EmaTemporalEnvelope,
  type EmaActionDoc,
} from "../src/index.js";

/**
 * Design Verification QA Suite: RFC-0002 Social Media Channel Architecture
 *
 * Evaluates the architecture strictly from the AGENT'S perspective:
 * 1. Agent Cognition: Can the agent accurately understand time, actors, and content?
 * 2. Multi-Channel Navigation: Can the agent navigate and operate across diverse channel kinds?
 * 3. Action Execution: Can the agent introspect schemas, make action decisions, and complete closed-loop interaction?
 */
describe("RFC-0002 Design QA - Agent Cognition, Multi-Channel Navigation & Action Execution", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let registryMap: Map<string, unknown>;
  let registry: EmaWorldRegistry;
  let ctx: EmaCtx;
  let tmpDir: string;
  let dbPath: string;

  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const companionActor: EmaActor = {
    id: "actor:ema-companion",
    name: "Ema Lifelong Companion",
    session: "session-2026-11-09-agent-qa",
    agentId: "emafanclub_ema_dev",
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ema-agent-qa-"));
    dbPath = path.join(tmpDir, "bili-agent-qa.sqlite");

    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
    registryMap = new Map();
    registry = {
      register: (name, world) => {
        registryMap.set(name, world);
        return { dispose: () => registryMap.delete(name) };
      },
      get: (name) => registryMap.get(name) as any,
      list: () =>
        [...registryMap.entries()].map(([name, world]) => ({ name, world: world as any })),
    };
    ctx = { router, inputBatcher, registry };
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // Dimension 1: Agent 会用了吗 (Agent Cognition & Temporal Perception)
  // =========================================================================
  describe("Dimension 1: Agent Cognition & Temporal Grounding (Agent 会用了吗)", () => {
    it("enables agent to accurately prioritize recent interactions over stale history without hallucinating elapsed time", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const anchorInstant = "2026-11-09T10:00:00.000Z";
      const anchorMs = Date.parse(anchorInstant);
      const channelId = "bilibili:dynamic:3546869527480631";

      // Item 1: Old post from 7 days ago
      world.indexSocialItem({
        id: "post-old",
        channelId,
        authorNodeId: "bilibili:person:fan-1",
        content: "上周的视频脚本讨论，请查收",
        createdAtMs: anchorMs - 7 * 86400000,
        fetchedAtMs: anchorMs - 10 * 60000,
      });

      // Item 2: Urgent question from 2 minutes ago
      world.indexSocialItem({
        id: "post-urgent",
        channelId,
        authorNodeId: "bilibili:person:fan-2",
        content: "Ema，今晚的直播几点开始呀？急！",
        createdAtMs: anchorMs - 2 * 60000,
        fetchedAtMs: anchorMs - 30000,
      });

      // Agent queries channel items
      const envelope = await router.read<EmaTemporalEnvelope<EmaChannelItem>>(
        `/world/bilibili/channels/${encodeURIComponent(channelId)}/items?time=${anchorInstant}`,
      );

      // 1. Agent receives anchored temporal context
      expect(envelope.context.time).toBe(anchorInstant);
      expect(envelope.context.timestampMs).toBe(anchorMs);

      // 2. Agent inspects relative timestamps directly
      const urgentItem = envelope.items.find((i) => i.id === "post-urgent")!;
      const oldItem = envelope.items.find((i) => i.id === "post-old")!;

      expect(urgentItem.createdAt).toBe("2 minutes ago (120 seconds ago)");
      expect(urgentItem.fetchedAt).toBe("just now (30 seconds ago)");

      expect(oldItem.createdAt).toBe("7 days ago (604800 seconds ago)");
      expect(oldItem.fetchedAt).toBe("10 minutes ago (600 seconds ago)");

      // Agent decision: Priority is post-urgent because deltaSec (120s) << (604800s)
      const agentSelected = envelope.items.sort((a, b) => {
        // Agent parses second deltas reliably
        const getSec = (str: string) => {
          const m = str.match(/\((\d+) seconds ago\)/);
          return m ? parseInt(m[1], 10) : 0;
        };
        return getSec(a.createdAt) - getSec(b.createdAt);
      })[0];

      expect(agentSelected.id).toBe("post-urgent");
      expect(agentSelected.content).toContain("今晚的直播几点开始呀");

      handle.dispose();
    });

    it("enables agent to recognize entity social actors and their roles via Node primitive", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Pre-index a bot node and a fan node
      world.indexSocialNode({
        id: "bilibili:bot:helper-bot",
        world: "bilibili",
        node_kind: "bot",
        name: "直播间自动场控姬",
        metadata: { isAutomated: true },
      });

      world.indexSocialNode({
        id: "bilibili:person:fan-sakura",
        world: "bilibili",
        node_kind: "person",
        name: "樱花奶绿",
        metadata: { fanMedalLevel: 21 },
      });

      // Agent queries entity nodes
      const botNode = await router.read<EmaNode>("/world/bilibili/nodes/bilibili:bot:helper-bot");
      const fanNode = await router.read<EmaNode>(
        "/world/bilibili/nodes/bilibili:person:fan-sakura",
      );
      const ownerNode = await router.read<EmaNode>(
        "/world/bilibili/nodes/bilibili:person:3546869527480631",
      );

      // Agent identifies node kinds accurately
      expect(botNode.node_kind).toBe("bot");
      expect(botNode.name).toBe("直播间自动场控姬");

      expect(fanNode.node_kind).toBe("person");
      expect(fanNode.name).toBe("樱花奶绿");
      expect((fanNode.metadata as any).fanMedalLevel).toBe(21);

      expect(ownerNode.node_kind).toBe("person");
      expect(ownerNode.name).toBe("Sakana酱ノ");

      handle.dispose();
    });
  });

  // =========================================================================
  // Dimension 2: Agent 能使用多种 channel 了吗 (Multi-Channel Navigation)
  // =========================================================================
  describe("Dimension 2: Multi-Channel Navigation & Cross-Channel Synthesis (Agent 能使用多种 channel 了吗)", () => {
    it("allows agent to traverse interconnected channels (space -> dynamic -> live_room -> video) using linkedChannelIds", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        videoTargets: ["BV1xx411c7mD"],
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // 1. Agent starts at creator root Node
      const creator = await router.read<EmaNode>(
        "/world/bilibili/nodes/bilibili:person:3546869527480631",
      );
      expect(creator.channelIds).toBeDefined();

      // 2. Agent inspects Space channel
      const spaceChannelId = creator.channelIds!.find((id) => id.includes(":space:"))!;
      const space = await router.read<BilibiliChannel>(
        `/world/bilibili/channels/${encodeURIComponent(spaceChannelId)}`,
      );
      expect(space.channel_kind).toBe("space");
      expect(space.linkedChannelIds).toBeDefined();

      // 3. Agent follows link to Dynamic channel
      const dynamicChannelId = space.linkedChannelIds!.find((id) => id.includes(":dynamic:"))!;
      const dynamic = await router.read<BilibiliChannel>(
        `/world/bilibili/channels/${encodeURIComponent(dynamicChannelId)}`,
      );
      expect(dynamic.channel_kind).toBe("dynamic");

      // 4. Agent follows link to Live Room channel
      const liveRoomChannelId = space.linkedChannelIds!.find((id) => id.includes(":live_room:"))!;
      const liveRoom = await router.read<BilibiliChannel>(
        `/world/bilibili/channels/${encodeURIComponent(liveRoomChannelId)}`,
      );
      expect(liveRoom.channel_kind).toBe("live_room");

      // 5. Agent inspects Video channel
      const videoChannel = await router.read<BilibiliChannel>("/world/bilibili/channels/video:BV1xx411c7mD");
      expect(videoChannel.channel_kind).toBe("video");

      // All channels adhere to unified EmaChannel interface
      const channelKinds = [space.channel_kind, dynamic.channel_kind, liveRoom.channel_kind, videoChannel.channel_kind];
      expect(channelKinds).toEqual(["space", "dynamic", "live_room", "video"]);

      handle.dispose();
    });

    it("allows agent to consume items from multiple channel kinds uniformly through common EmaChannelItem contract", async () => {
      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        videoTargets: ["BV1xx411c7mD"],
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      const now = Date.now();

      // Feed items into different channel kinds
      // 1. Dynamic post
      world.indexSocialItem({
        id: "item-dynamic-1",
        channelId: "bilibili:dynamic:3546869527480631",
        authorNodeId: "bilibili:person:3546869527480631",
        name: "伴侣系统新版本发布",
        content: "今天 Ema 伴侣接入了全新多频道感知机制 ✨",
        createdAtMs: now - 3600000,
      });

      // 2. Live room barrage
      world.indexSocialItem({
        id: "item-live-danmaku-1",
        channelId: "bilibili:live_room:123456",
        authorNodeId: "bilibili:person:fan-live-8",
        content: "伴侣在直播间也能看到我们发弹幕吗？",
        createdAtMs: now - 60000,
      });

      // 3. Video comment
      world.indexSocialItem({
        id: "item-video-comment-1",
        channelId: "bilibili:video:BV1xx411c7mD",
        authorNodeId: "bilibili:person:fan-video-9",
        content: "这期视频剪辑太棒了，求下一期！",
        createdAtMs: now - 1800000,
      });

      // Agent reads all three channels
      const dynamicItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/dynamic/items",
      );
      const liveItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/room:123456/items",
      );
      const videoItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/video:BV1xx411c7mD/items",
      );

      // Agent operates on homogeneous item fields (id, channelId, authorNodeId, content, createdAt, fetchedAt)
      const allReadItems = [...dynamicItems.items, ...liveItems.items, ...videoItems.items];
      expect(allReadItems.length).toBe(3);

      for (const item of allReadItems) {
        expect(typeof item.id).toBe("string");
        expect(typeof item.channelId).toBe("string");
        expect(typeof item.authorNodeId).toBe("string");
        expect(typeof item.content).toBe("string");
        expect(typeof item.createdAt).toBe("string");
        expect(typeof item.fetchedAt).toBe("string");
        expect(item.createdAt).toContain("ago");
      }

      handle.dispose();
    });

    it("demonstrates cross-world coordination between Penguin Channel World and Bilibili Channels", async () => {
      const dispatchedOrgMessages: string[] = [];
      const dispatchedBilibiliDanmaku: string[] = [];

      // 1. Mount PenguinChannelWorld (Org / Team communications)
      const penguinWorld = new PenguinChannelWorld({
        channels: ["ch_ema_dev_ops"],
        dbPath: ":memory:",
        channelFetcher: () => [],
        channelSender: (_ch, msg) => {
          dispatchedOrgMessages.push(msg);
        },
        env: mockEnv,
      });
      const penguinHandle = penguinWorld.start(ctx);

      // 2. Mount BilibiliWorld (External social world)
      const bilibiliWorld = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        danmakuSender: (_room, msg) => {
          dispatchedBilibiliDanmaku.push(msg);
        },
        passive: true,
        env: mockEnv,
      });
      const biliHandle = bilibiliWorld.start(ctx);

      // 3. Scenario: Agent receives an instruction in Penguin Org Channel:
      // "Board instruction: Please broadcast live room start notification on Bilibili"
      penguinWorld.interact(ctx, companionActor, "ch_ema_dev_ops", "reply", "收到任务，正在向 Bilibili 直播间 123456 同步开播弹幕。");

      // 4. Agent inspects Bilibili live room and sends danmaku action
      const liveRoom = await router.read<BilibiliChannel>("/world/bilibili/channels/room:123456");
      expect(liveRoom.channel_kind).toBe("live_room");

      bilibiliWorld.interact(ctx, companionActor, "danmaku.send", {
        roomId: "123456",
        message: "【系统通告】Ema 伴侣与开发组全线连接正常，直播互动开始 ✨",
      });

      // 5. Verify multi-world outcomes
      expect(dispatchedOrgMessages.length).toBe(1);
      expect(dispatchedOrgMessages[0]).toContain("收到任务，正在向 Bilibili");

      expect(dispatchedBilibiliDanmaku.length).toBe(1);
      expect(dispatchedBilibiliDanmaku[0]).toContain("Ema 伴侣与开发组全线连接正常");

      penguinHandle.dispose();
      biliHandle.dispose();
    });
  });

  // =========================================================================
  // Dimension 3: Agent 能使用 action 吗 (Runtime Discovery & Action Execution)
  // =========================================================================
  describe("Dimension 3: Action Introspection & Decision Loop (Agent 能使用 action 吗)", () => {
    it("allows agent to discover action schemas and inspect parameters dynamically without hardcoded assumptions", async () => {
      const world = new BilibiliWorld({
        dbPath,
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // Agent introspects /world/bilibili/actions
      const docsRes = await router.read<{ actions: EmaActionDoc[] }>("/world/bilibili/actions");
      const actionMap = new Map(docsRes.actions.map((a) => [a.name, a]));

      // Verify agent discovers all required hierarchical actions
      expect(actionMap.has("post.publish")).toBe(true);
      expect(actionMap.has("comment.reply")).toBe(true);
      expect(actionMap.has("comment.like")).toBe(true);
      expect(actionMap.has("danmaku.send")).toBe(true);
      expect(actionMap.has("dm.send")).toBe(true);
      expect(actionMap.has("danmaku.thank_gift")).toBe(true);
      expect(actionMap.has("danmaku.thank_superchat")).toBe(true);
      expect(actionMap.has("danmaku.thank_guard")).toBe(true);

      // Agent inspects schema for comment.reply
      const replyDoc = actionMap.get("comment.reply")!;
      expect(replyDoc.parameters.targetId.required).toBe(true);
      expect(replyDoc.parameters.message.required).toBe(true);
      expect(replyDoc.parameters.rootId.required).toBe(false);

      // Agent inspects rate limit
      expect(replyDoc.rateLimit).toBe("20/minute");

      handle.dispose();
    });

    it("executes diverse companion social action decisions and validates closed-loop perception", async () => {
      const capturedOutbound = {
        dynamics: [] as string[],
        comments: [] as Array<{ targetId: string; message: string }>,
        danmaku: [] as Array<{ roomId: string; message: string }>,
        dms: [] as Array<{ mid: string; message: string }>,
        likes: [] as Array<{ targetId: string; commentId: string }>,
      };

      const world = new BilibiliWorld({
        dbPath,
        ownerUid: "3546869527480631",
        rooms: ["123456"],
        videoTargets: ["BV1xx411c7mD"],
        dmTargets: ["1001"],
        dynamicSender: (text) => capturedOutbound.dynamics.push(text),
        commentSender: (targetId, message) => capturedOutbound.comments.push({ targetId, message }),
        danmakuSender: (roomId, message) => capturedOutbound.danmaku.push({ roomId, message }),
        dmSender: (mid, message) => capturedOutbound.dms.push({ mid, message }),
        commentLikeSender: (targetId, commentId) => capturedOutbound.likes.push({ targetId, commentId }),
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // --- Scenario A: Agent responds to fan comment under video ---
      world.interact(ctx, companionActor, "comment.reply", {
        targetId: "BV1xx411c7mD",
        message: "感谢关注！你的意见对 Ema 的进化至关重要。",
        rootId: "comment-root-99",
      });
      expect(capturedOutbound.comments.length).toBe(1);
      expect(capturedOutbound.comments[0].message).toContain("感谢关注");

      // Closed-loop verification: Comment is immediately recorded in local channel index
      const videoItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/video:BV1xx411c7mD/items",
      );
      expect(videoItems.items.some((i) => i.content.includes("你的意见对 Ema 的进化至关重要"))).toBe(true);

      // --- Scenario B: Agent likes top fan comment ---
      world.interact(ctx, companionActor, "comment.like", {
        postId: "BV1xx411c7mD",
        commentId: "comment-fan-star",
      });
      expect(capturedOutbound.likes.length).toBe(1);
      expect(capturedOutbound.likes[0].commentId).toBe("comment-fan-star");

      // --- Scenario C: Agent broadcasts thank-you danmaku for gift ---
      world.interact(ctx, companionActor, "danmaku.thank_gift", {
        roomId: "123456",
        uname: "夜神月",
        giftName: "小电视飞船",
        num: 1,
      });
      expect(capturedOutbound.danmaku.length).toBe(1);
      expect(capturedOutbound.danmaku[0].message).toContain("感谢 夜神月 赠送的 小电视飞船");

      // --- Scenario D: Agent publishes companion milestone dynamic ---
      world.interact(ctx, companionActor, "post.publish", {
        message: "【伴侣日记】今天与大家在直播间度过了温暖的时光，明天见！🌙",
      });
      expect(capturedOutbound.dynamics.length).toBe(1);

      // Closed-loop verification: Dynamic is in local feed index
      const dynamicItems = await router.read<{ items: EmaChannelItem[] }>(
        "/world/bilibili/channels/dynamic/items",
      );
      expect(dynamicItems.items.some((i) => i.content.includes("今天与大家在直播间度过了温暖的时光"))).toBe(true);

      // --- Scenario E: Agent replies to direct message fan inquiry ---
      world.interact(ctx, companionActor, "dm.send", {
        mid: "1001",
        message: "私信已收到！伴侣记忆模型已为你更新档案。",
      });
      expect(capturedOutbound.dms.length).toBe(1);
      expect(capturedOutbound.dms[0].message).toContain("伴侣记忆模型已为你更新档案");

      handle.dispose();
    });

    it("protects agent from host privacy leakage and flooding rate abuse during action calling", async () => {
      const world = new BilibiliWorld({
        dbPath,
        rooms: ["123456"],
        rateLimits: { danmakuMinIntervalMs: 3000 },
        passive: true,
        env: mockEnv,
      });
      const handle = world.start(ctx);

      // 1. Agent privacy guardrail: Rejects attempt to leak local files or secrets
      expect(() => {
        world.interact(ctx, companionActor, "danmaku.send", {
          roomId: "123456",
          message: "调试信息：配置文件在 /home/rei/repos/.vault.toml",
        });
      }).toThrow(BilibiliContentFilterError);

      expect(() => {
        world.interact(ctx, companionActor, "post.publish", {
          message: "API 密钥为 sk-123456789012345678901234567890",
        });
      }).toThrow(BilibiliContentFilterError);

      // 2. Agent anti-flooding guardrail: Prevents rapid-fire loops
      world.interact(ctx, companionActor, "danmaku.send", {
        roomId: "123456",
        message: "合规弹幕消息 1",
      });

      expect(() => {
        world.interact(ctx, companionActor, "danmaku.send", {
          roomId: "123456",
          message: "过快发送的弹幕消息 2",
        });
      }).toThrow(BilibiliRateLimitError);

      handle.dispose();
    });
  });
});
