import { describe, it, expect, vi } from "vitest";
import {
  SnowlumaWorld,
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  compareIntimacy,
  computeIntimacyStage,
  parseCQMessage,
  parseSegmentMessage,
  unescapeCQValue,
  escapeCQValue,
  type EmaCtx,
  type EmaActor,
  type OneBotEvent,
  type OneBotApiCall,
} from "../src/index.js";

describe("SnowlumaWorld - OneBot 11 / QQ Gateway Adapter (RFC-0001)", () => {
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const mockActor: EmaActor = {
    id: "actor-ema-companion",
    name: "Ema Companion",
    session: "session-2026-11-08-test",
    agentId: "emafanclub_ema_dev",
  };

  function createTestCtx(router: SimpleEmaRouter, batcher: SimpleEmaInputBatcher): EmaCtx {
    return {
      router,
      inputBatcher: batcher,
      registry: {
        register: () => ({ dispose: () => {} }),
        get: () => undefined,
        list: () => [],
      },
    };
  }

  describe("RFC-0001 Architecture & Lifecycle", () => {
    it("initializes, starts, mounts routes, and disposes cleanly", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        groups: ["group:123456", "789012"],
        privateUsers: ["private:987654"],
        dbPath: ":memory:",
        env: mockEnv,
      });

      const handle = world.start(ctx);

      const routes = router.listRoutes();
      expect(routes.map((r) => r.prefix)).toContain("/world/qq/*");

      const partsRes = await router.read<{ world: string; parts: Array<{ id: string }> }>(
        "/world/qq/parts",
      );
      expect(partsRes.world).toBe("qq");
      expect(partsRes.parts.map((p) => p.id)).toEqual([
        "group:123456",
        "group:789012",
        "private:987654",
      ]);

      handle.dispose();
      await expect(router.read("/world/qq/parts")).rejects.toThrow("Route not found");
      batcher.dispose();
    });
  });

  describe("CQ Code & Segment Parsing Utilities", () => {
    it("escapes and unescapes CQ parameter values correctly", () => {
      const raw = "hello,world [test] & more";
      const escaped = escapeCQValue(raw);
      expect(escaped).toBe("hello&#44;world &#91;test&#93; &amp; more");
      expect(unescapeCQValue(escaped)).toBe(raw);
    });

    it("parses rich CQ codes from string messages", () => {
      const raw =
        "[CQ:reply,id=9988] [CQ:at,qq=12345] Hello Ema! [CQ:image,file=cat.jpg,url=http://img.com/cat.jpg] [CQ:face,id=14] [CQ:record,file=voice.amr]";

      const parsed = parseCQMessage(raw);
      expect(parsed.replyTo).toBe("9988");
      expect(parsed.content).toBe("@12345 Hello Ema! [图片] [表情:14] [语音]");
      expect(parsed.metadata.atUids).toEqual(["12345"]);
      expect(parsed.metadata.images).toEqual([{ file: "cat.jpg", url: "http://img.com/cat.jpg" }]);
      expect(parsed.metadata.voice).toEqual({
        file: "voice.amr",
        url: undefined,
      });
    });

    it("parses JSON card CQ codes", () => {
      const raw = '[CQ:json,data={"app":"com.tencent.miniapp","meta":{"detail":"test"}}]';
      const parsed = parseCQMessage(raw);
      expect(parsed.content).toBe("[卡片消息]");
      expect(parsed.metadata.jsonCard).toEqual({
        app: "com.tencent.miniapp",
        meta: { detail: "test" },
      });
    });

    it("parses OneBot segment arrays into normalized text and metadata", () => {
      const segments = [
        { type: "reply", data: { id: "7766" } },
        { type: "at", data: { qq: "55555" } },
        { type: "text", data: { text: "Look at this cat" } },
        { type: "image", data: { file: "cat.png", url: "http://cat.png" } },
        { type: "face", data: { id: "21" } },
      ];

      const parsed = parseSegmentMessage(segments);
      expect(parsed.replyTo).toBe("7766");
      expect(parsed.content).toBe("@55555 Look at this cat [图片] [表情:21]");
      expect(parsed.metadata.atUids).toEqual(["55555"]);
      expect(parsed.metadata.images).toEqual([{ file: "cat.png", url: "http://cat.png" }]);
    });
  });

  describe("Input Adapter: Event Ingestion & Normalization (node-mw33skpc-825f)", () => {
    it("ingests and normalizes group message events", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const pushedInputs: unknown[] = [];
      vi.spyOn(batcher, "push").mockImplementation((input) => {
        pushedInputs.push(input);
      });

      const world = new SnowlumaWorld({
        selfId: "100001",
        ownerUids: ["888888"],
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const event: OneBotEvent = {
        time: 1731000000,
        self_id: "100001",
        post_type: "message",
        message_type: "group",
        message_id: 101,
        user_id: "888888",
        group_id: "654321",
        message: "[CQ:at,qq=100001] Good morning Ema!",
        sender: {
          user_id: "888888",
          nickname: "Boss",
          card: "Master",
        },
      };

      const input = await world.ingestEvent(event);
      expect(input).not.toBeNull();
      expect(input?.id).toBe("101");
      expect(input?.world).toBe("qq");
      expect(input?.partId).toBe("group:654321");
      expect(input?.sender.id).toBe("user:qq:888888");
      expect(input?.sender.name).toBe("Master");
      expect(input?.sender.isOwner).toBe(true);
      expect(input?.content).toBe("@100001 Good morning Ema!");
      expect(input?.timestamp).toBe(1731000000 * 1000);

      expect(pushedInputs.length).toBe(1);
      batcher.dispose();
      world.dispose();
    });

    it("ingests and normalizes private message events", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const event: OneBotEvent = {
        time: 1731000005,
        self_id: "100001",
        post_type: "message",
        message_type: "private",
        message_id: 102,
        user_id: "333444",
        message: "Hello in private!",
        sender: {
          user_id: "333444",
          nickname: "Friend",
        },
      };

      const input = await world.ingestEvent(event);
      expect(input).not.toBeNull();
      expect(input?.partId).toBe("private:333444");
      expect(input?.sender.id).toBe("user:qq:333444");
      expect(input?.sender.name).toBe("Friend");
      expect(input?.sender.isOwner).toBe(false);
      expect(input?.content).toBe("Hello in private!");

      batcher.dispose();
      world.dispose();
    });

    it("prevents loops by dropping messages sent by the bot account itself", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const botSelfEvent: OneBotEvent = {
        post_type: "message",
        message_type: "group",
        message_id: 103,
        user_id: "100001",
        group_id: "654321",
        message: "I am replying as bot",
        sender: { user_id: "100001", nickname: "EmaBot" },
      };

      const input = await world.ingestEvent(botSelfEvent);
      expect(input).toBeNull();

      batcher.dispose();
      world.dispose();
    });

    it("deduplicates repeated message IDs", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const event: OneBotEvent = {
        post_type: "message",
        message_type: "private",
        message_id: "dup-1",
        user_id: "222333",
        message: "First arrival",
      };

      const first = await world.ingestEvent(event);
      expect(first).not.toBeNull();

      const second = await world.ingestEvent(event);
      expect(second).toBeNull();

      batcher.dispose();
      world.dispose();
    });

    it("normalizes poke events (戳一戳) targeting the bot companion", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const pokeBotEvent: OneBotEvent = {
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
        operator_id: "777888",
        target_id: "100001",
        group_id: "999000",
      };

      const input = await world.ingestEvent(pokeBotEvent);
      expect(input).not.toBeNull();
      expect(input?.partId).toBe("group:999000");
      expect(input?.sender.id).toBe("user:qq:777888");
      expect(input?.content).toBe("[戳了戳我]");

      batcher.dispose();
      world.dispose();
    });

    it("normalizes poke events between other users in a group", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const peerPokeEvent: OneBotEvent = {
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
        operator_id: "111222",
        target_id: "333444",
        group_id: "999000",
      };

      const input = await world.ingestEvent(peerPokeEvent);
      expect(input).not.toBeNull();
      expect(input?.content).toBe("[user:qq:111222 戳了戳 user:qq:333444]");

      batcher.dispose();
      world.dispose();
    });

    it("normalizes group card and lucky king notice events", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      // Group Card Change
      const cardEvent: OneBotEvent = {
        post_type: "notice",
        notice_type: "group_card",
        group_id: "112233",
        user_id: "445566",
        card_old: "OldNick",
        card_new: "NewNick",
      };
      const cardInput = await world.ingestEvent(cardEvent);
      expect(cardInput?.content).toContain(
        '[群名片变动: user:qq:445566 从 "OldNick" 变为 "NewNick"]',
      );

      // Lucky King
      const luckyEvent: OneBotEvent = {
        post_type: "notice",
        notice_type: "notify",
        sub_type: "lucky_king",
        group_id: "112233",
        target_id: "778899",
      };
      const luckyInput = await world.ingestEvent(luckyEvent);
      expect(luckyInput?.content).toBe("[运气王: user:qq:778899 成为运气王]");

      batcher.dispose();
      world.dispose();
    });
  });

  describe("Transactional Input Batching & XML Coalescing", () => {
    it("batches rapid incoming QQ messages within debounce window into atomic XML payload", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({
        dbPath: ":memory:",
        debounceMs: 50,
        maxWaitMs: 200,
      });
      const ctx = createTestCtx(router, batcher);

      const capturedXmls: string[] = [];
      batcher.onBatch((batch) => {
        const xml = formatBatchToXml(batch);
        capturedXmls.push(xml);
        batcher.markCompleted(batch.map((b) => b.id));
      });

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      // Push two rapid messages from same QQ user
      await world.ingestEvent({
        post_type: "message",
        message_type: "group",
        message_id: "msg-qq-1",
        user_id: "555666",
        group_id: "group-888",
        message: "Will there be stars tonight?",
        sender: { nickname: "Stargazer" },
      });

      await world.ingestEvent({
        post_type: "message",
        message_type: "group",
        message_id: "msg-qq-2",
        user_id: "555666",
        group_id: "group-888",
        message: "Shall we go watch together?",
        sender: { nickname: "Stargazer" },
      });

      // Initially debouncing
      expect(capturedXmls.length).toBe(0);

      // Await debounce window
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(capturedXmls.length).toBe(1);
      const xml = capturedXmls[0];
      expect(xml).toContain("<World>qq</World>");
      expect(xml).toContain("<Channel>group:group-888</Channel>");
      expect(xml).toContain("<Name>Stargazer</Name>");
      expect(xml).toContain('<Message id="msg-qq-1">Will there be stars tonight?</Message>');
      expect(xml).toContain('<Message id="msg-qq-2">Shall we go watch together?</Message>');

      batcher.dispose();
      world.dispose();
    });
  });

  describe("Action Execution & Rich CQ Codes (node-mw3giuy1-d39y)", () => {
    it("enforces agent identity assertion before any action dispatch", () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: {}, // Missing PENGUIN_AGENT_ID
      });

      expect(() => {
        world.interact(ctx, mockActor, "group:12345", "hello");
      }).toThrow(/refusing to dispatch without an agent identity/);

      batcher.dispose();
    });

    it("dispatches group messages with send_group_msg and rich CQ codes", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const sentCalls: OneBotApiCall[] = [];
      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
        apiCaller: (call) => {
          sentCalls.push(call);
          return {
            status: "ok",
            retcode: 0,
            data: { message_id: 888123 },
          };
        },
      });
      world.start(ctx);

      world.interact(ctx, mockActor, "group:998877", {
        text: "Here is your picture!",
        replyTo: 1001,
        at: [123456],
        images: ["http://cat.jpg"],
        faces: [14],
      });

      // Await microtasks for async apiCaller
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sentCalls.length).toBe(1);
      const call = sentCalls[0];
      expect(call.action).toBe("send_group_msg");
      expect(call.params.group_id).toBe(998877);
      const msg = call.params.message as string;
      expect(msg).toContain("[CQ:reply,id=1001]");
      expect(msg).toContain("[CQ:at,qq=123456]");
      expect(msg).toContain("Here is your picture!");
      expect(msg).toContain("[CQ:face,id=14]");
      expect(msg).toContain("[CQ:image,file=http://cat.jpg]");

      const receipts = world.getDeliveryReceipts();
      expect(receipts.length).toBe(1);
      expect(receipts[0].messageId).toBe("888123");
      expect(receipts[0].partId).toBe("group:998877");

      batcher.dispose();
      world.dispose();
    });

    it("dispatches private messages with send_private_msg", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const sentCalls: OneBotApiCall[] = [];
      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
        apiCaller: (call) => {
          sentCalls.push(call);
          return { status: "ok", retcode: 0, data: { message_id: 554433 } };
        },
      });
      world.start(ctx);

      world.interact(ctx, mockActor, "private:334455", "Hello direct message!");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sentCalls.length).toBe(1);
      expect(sentCalls[0].action).toBe("send_private_msg");
      expect(sentCalls[0].params.user_id).toBe(334455);
      expect(sentCalls[0].params.message).toBe("Hello direct message!");

      batcher.dispose();
      world.dispose();
    });

    it("deduplicates identical messages sent within the deduplication window", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      let callCount = 0;
      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
        apiCaller: () => {
          callCount++;
          return { status: "ok", retcode: 0 };
        },
      });
      world.start(ctx);

      world.interact(ctx, mockActor, "group:123", "Same message burst");
      world.interact(ctx, mockActor, "group:123", "Same message burst"); // duplicate

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callCount).toBe(1);

      // Force dispatch bypasses deduplication
      world.interact(ctx, mockActor, "group:123", {
        text: "Same message burst",
        force: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callCount).toBe(2);

      batcher.dispose();
      world.dispose();
    });
  });

  describe("Relational Intimacy Gating & Proactive Greetings", () => {
    it("computes intimacy stages and stage comparison properly", () => {
      expect(computeIntimacyStage(10)).toBe("stranger");
      expect(computeIntimacyStage(25)).toBe("acquaintance");
      expect(computeIntimacyStage(50)).toBe("casual_friend");
      expect(computeIntimacyStage(70)).toBe("close_friend");
      expect(computeIntimacyStage(85)).toBe("trusted_companion");
      expect(computeIntimacyStage(98)).toBe("soulmate");

      expect(compareIntimacy("trusted_companion", "close_friend")).toBeGreaterThan(0);
      expect(compareIntimacy("stranger", "trusted_companion")).toBeLessThan(0);
    });

    it("refuses proactive greetings when intimacy stage is below trusted_companion", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      world.setIntimacy("user_low", { score: 30, stage: "acquaintance" });

      const res = await world.sendProactiveGreeting(ctx, mockActor, "user_low", "wake");
      expect(res.sent).toBe(false);
      expect(res.reason).toBe("insufficient_intimacy");

      // Verify interact throws on direct proactive attempt
      expect(() => {
        world.interact(ctx, mockActor, "private:user_low", {
          text: "Wake up!",
          isProactive: true,
        });
      }).toThrow(/is below 'trusted_companion'/);

      batcher.dispose();
      world.dispose();
    });

    it("refuses proactive greetings when DND is enabled or during quiet hours", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      // Intimacy is high enough, but DND is on
      world.setIntimacy("user_dnd", {
        score: 90,
        stage: "trusted_companion",
        dnd: true,
      });

      const dndRes = await world.sendProactiveGreeting(ctx, mockActor, "user_dnd", "wake");
      expect(dndRes.sent).toBe(false);
      expect(dndRes.reason).toBe("dnd_enabled");

      // Intimacy high, DND off, but quiet hours active
      world.setIntimacy("user_qh", {
        score: 90,
        stage: "trusted_companion",
        dnd: false,
        quietHours: { startHour: 0, endHour: 24 }, // all day quiet
      });

      const qhRes = await world.sendProactiveGreeting(ctx, mockActor, "user_qh", "sleep");
      expect(qhRes.sent).toBe(false);
      expect(qhRes.reason).toBe("quiet_hours");

      batcher.dispose();
      world.dispose();
    });

    it("successfully dispatches proactive greetings when relational conditions are satisfied", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const sentCalls: OneBotApiCall[] = [];
      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
        apiCaller: (call) => {
          sentCalls.push(call);
          return { status: "ok", retcode: 0, data: { message_id: 112233 } };
        },
      });
      world.start(ctx);

      world.setIntimacy("user_soulmate", {
        score: 95,
        stage: "soulmate",
        dnd: false,
        quietHours: { startHour: 3, endHour: 4 }, // quiet only 3am-4am
      });

      // Mock current hour not in quiet hours
      vi.spyOn(world, "isQuietHours").mockReturnValue(false);

      const res = await world.sendProactiveGreeting(ctx, mockActor, "user_soulmate", "wake");
      expect(res.sent).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sentCalls.length).toBe(1);
      expect(sentCalls[0].action).toBe("send_private_msg");
      expect(sentCalls[0].params.user_id).toBe("user_soulmate");
      expect(sentCalls[0].params.message).toContain("早安");

      batcher.dispose();
      world.dispose();
    });
  });

  describe("SimpleEmaRouter Endpoints & Observability", () => {
    it("serves parts, status, message queries, and intimacy inspection", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        groups: ["group:456"],
        privateUsers: ["private:123"],
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      // Ingest a message
      await world.ingestEvent({
        post_type: "message",
        message_type: "group",
        message_id: "msg-test-99",
        user_id: "123",
        group_id: "456",
        message: "Router query test",
      });

      // 1. Query parts
      const partsRes = await router.read<{ parts: Array<{ id: string }> }>("/world/qq/parts");
      expect(partsRes.parts.map((p) => p.id)).toContain("group:456");

      // 2. Query specific part
      const partRes = await router.read<{ id: string; type: string }>("/world/qq/parts/group:456");
      expect(partRes.id).toBe("group:456");
      expect(partRes.type).toBe("group");

      // 3. Query message
      const msgRes = await router.read<{ id: string; content: string }>(
        "/world/qq/messages/msg-test-99",
      );
      expect(msgRes.id).toBe("msg-test-99");
      expect(msgRes.content).toBe("Router query test");

      // 4. Query status
      const statusRes = await router.read<{
        world: string;
        selfId: string;
        partsCount: number;
        seenCount: number;
      }>("/world/qq/status");
      expect(statusRes.world).toBe("qq");
      expect(statusRes.selfId).toBe("100001");
      expect(statusRes.partsCount).toBeGreaterThanOrEqual(2);
      expect(statusRes.seenCount).toBe(1);

      // 5. Query and update intimacy over router
      const initialIntimacy = await router.read<{ userId: string; score: number }>(
        "/world/qq/intimacy/123",
      );
      expect(initialIntimacy.userId).toBe("123");

      const updatedIntimacy = await router.read<{ userId: string; stage: string }>(
        "/world/qq/intimacy/123",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: 85 }),
        },
      );
      expect(updatedIntimacy.stage).toBe("trusted_companion");

      batcher.dispose();
      world.dispose();
    });

    it("ingests incoming OneBot 11 events via HTTP POST webhook endpoint", async () => {
      const router = new SimpleEmaRouter();
      const batcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
      const ctx = createTestCtx(router, batcher);

      const world = new SnowlumaWorld({
        selfId: "100001",
        dbPath: ":memory:",
        env: mockEnv,
      });
      world.start(ctx);

      const webhookPayload = {
        post_type: "message",
        message_type: "private",
        message_id: "webhook-msg-1",
        user_id: "998877",
        message: "Hello from OneBot 11 HTTP webhook!",
        sender: { nickname: "WebhookTester" },
      };

      const res = await router.read<{ status: string; processed: boolean; inputId?: string }>(
        "/world/qq/event",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
        },
      );

      expect(res.status).toBe("ok");
      expect(res.processed).toBe(true);
      expect(res.inputId).toBe("webhook-msg-1");

      const fetchedMsg = await router.read<{ content: string }>("/world/qq/messages/webhook-msg-1");
      expect(fetchedMsg.content).toBe("Hello from OneBot 11 HTTP webhook!");

      batcher.dispose();
      world.dispose();
    });
  });

  describe("SQLite State Persistence", () => {
    it("persists seen messages and intimacy across world restarts", async () => {
      const dbPath = `/tmp/snowluma-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;

      // Session 1: Create world and populate state
      const world1 = new SnowlumaWorld({
        selfId: "100001",
        dbPath,
        env: mockEnv,
      });
      world1.setIntimacy("persisted_user", { score: 92, stage: "trusted_companion" });
      await world1.ingestEvent({
        post_type: "message",
        message_type: "group",
        message_id: "persisted-msg-1",
        user_id: "persisted_user",
        group_id: "persisted_group",
        message: "First persisted run",
      });
      world1.dispose();

      // Session 2: Reopen world with same sqlite database
      const world2 = new SnowlumaWorld({
        selfId: "100001",
        dbPath,
        env: mockEnv,
      });

      // Verify intimacy was restored (92 + 1 from ingestEvent interaction = 93)
      const restoredProfile = world2.getIntimacy("persisted_user");
      expect(restoredProfile.score).toBe(93);
      expect(restoredProfile.stage).toBe("trusted_companion");

      // Verify seen messages were restored (rejecting duplicate message)
      const duplicateIngest = await world2.ingestEvent({
        post_type: "message",
        message_type: "group",
        message_id: "persisted-msg-1",
        user_id: "persisted_user",
        group_id: "persisted_group",
        message: "First persisted run",
      });
      expect(duplicateIngest).toBeNull();

      world2.dispose();
    });
  });
});
