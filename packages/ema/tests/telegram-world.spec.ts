import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SimpleEmaRouter,
  SimpleEmaInputBatcher,
  formatBatchToXml,
  TelegramWorld,
  escapeMarkdownV2,
  mdV2Bold,
  mdV2Italic,
  mdV2Code,
  mdV2Pre,
  mdV2Link,
  mdV2Spoiler,
  mdV2Strikethrough,
  mdV2Underline,
  inlineKeyboard,
  type EmaCtx,
  type EmaActor,
  type EmaWorldRegistry,
  type TelegramUpdate,
  type TelegramActionPayload,
  type RawMtprotoUpdate,
} from "../src/index.js";

describe("TelegramWorld - RFC-0001 Architecture & Invariants", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let registryMap: Map<string, unknown>;
  let registry: EmaWorldRegistry;
  let ctx: EmaCtx;
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const mockActor: EmaActor = {
    id: "actor-ema-companion",
    name: "Ema Companion",
    session: "session-2026-11-08-test",
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
    it("registers with registry and mounts endpoints under /world/telegram", async () => {
      const world = new TelegramWorld({
        passive: true,
        parts: [
          { id: "channel:1234", type: "channel", name: "Announcement Channel" },
          { id: "group:5678", type: "group", name: "Community Group" },
        ],
        env: mockEnv,
      });

      const handle = world.start(ctx);

      expect(registry.get("telegram")).toBe(world);

      const status = await router.read<{ world: string; partsCount: number }>("/world/telegram");
      expect(status.world).toBe("telegram");
      expect(status.partsCount).toBe(2);

      const partsRes = await router.read<{ world: string; parts: Array<{ id: string }> }>(
        "/world/telegram/parts",
      );
      expect(partsRes.parts.length).toBe(2);
      expect(partsRes.parts.map((p) => p.id)).toContain("channel:1234");
      expect(partsRes.parts.map((p) => p.id)).toContain("group:5678");

      const singlePart = await router.read<{ id: string; name: string }>(
        "/world/telegram/parts/channel:1234",
      );
      expect(singlePart.id).toBe("channel:1234");
      expect(singlePart.name).toBe("Announcement Channel");

      handle.dispose();
      expect(registry.get("telegram")).toBeUndefined();
      await expect(router.read("/world/telegram")).rejects.toThrow("Route not found");
    });

    it("throws error for non-existent part queries", async () => {
      const world = new TelegramWorld({ passive: true, env: mockEnv });
      const handle = world.start(ctx);

      await expect(router.read("/world/telegram/parts/unknown:999")).rejects.toThrow(
        "Part not found",
      );

      handle.dispose();
    });
  });

  describe("Identity Guard & Authentication Invariants", () => {
    it("refuses interact without operating agent identity (assertAgentIdentity)", () => {
      const world = new TelegramWorld({ passive: true, env: { PENGUIN_AGENT_ID: "" } });
      world.start(ctx);

      expect(() => {
        world.interact(ctx, mockActor, "channel:1234", "Hello world");
      }).toThrow("refusing to dispatch without an agent identity");

      world.dispose();
    });

    it("refuses interact with invalid or missing EmaActor credentials", () => {
      const world = new TelegramWorld({ passive: true, env: mockEnv });
      world.start(ctx);

      expect(() => {
        world.interact(ctx, null as any, "channel:1234", "Hello world");
      }).toThrow("Invalid or unauthenticated EmaActor credentials");

      expect(() => {
        world.interact(ctx, { id: "" } as any, "channel:1234", "Hello world");
      }).toThrow("Invalid or unauthenticated EmaActor credentials");

      world.dispose();
    });
  });
});

describe("TelegramWorld - Input Node (node-mw7rlppg-ae0e)", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let ctx: EmaCtx;
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };

  beforeEach(() => {
    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({ dbPath: ":memory:", debounceMs: 40 });
    const regMap = new Map();
    ctx = {
      router,
      inputBatcher,
      registry: {
        register: (name, w) => {
          regMap.set(name, w);
          return { dispose: () => regMap.delete(name) };
        },
        get: (name) => regMap.get(name),
        list: () => [...regMap.entries()].map(([name, world]) => ({ name, world })),
      },
    };
  });

  it("normalizes multi-part channel, group, DM, and thread updates", async () => {
    const world = new TelegramWorld({
      passive: true,
      ownerIds: [987, "alice"],
      env: mockEnv,
    });
    const handle = world.start(ctx);

    // 1. Channel post
    const channelUpdate: TelegramUpdate = {
      update_id: 101,
      channel_post: {
        message_id: 1,
        date: 1700000000,
        chat: { id: -1001234, type: "channel", title: "News Channel" },
        text: "Breaking update from Channel",
      },
    };
    const chInput = world.ingestUpdate(channelUpdate);
    expect(chInput).not.toBeNull();
    expect(chInput?.world).toBe("telegram");
    expect(chInput?.partId).toBe("channel:-1001234");
    expect(chInput?.content).toBe("Breaking update from Channel");

    // 2. DM (private chat) from owner
    const dmUpdate: TelegramUpdate = {
      update_id: 102,
      message: {
        message_id: 2,
        date: 1700000001,
        chat: { id: 987, type: "private", first_name: "Alice", username: "alice" },
        from: { id: 987, first_name: "Alice", username: "alice", is_bot: false },
        text: "Direct question for Ema",
      },
    };
    const dmInput = world.ingestUpdate(dmUpdate);
    expect(dmInput?.partId).toBe("dm:987");
    expect(dmInput?.sender.id).toBe("user:987");
    expect(dmInput?.sender.name).toBe("Alice");
    expect(dmInput?.sender.isOwner).toBe(true);

    // 3. Regular group chat from non-owner
    const groupUpdate: TelegramUpdate = {
      update_id: 103,
      message: {
        message_id: 3,
        date: 1700000002,
        chat: { id: -5678, type: "group", title: "Tech Group" },
        from: { id: 555, first_name: "Bob", is_bot: false },
        text: "Group inquiry",
      },
    };
    const grpInput = world.ingestUpdate(groupUpdate);
    expect(grpInput?.partId).toBe("group:-5678");
    expect(grpInput?.sender.isOwner).toBe(false);

    // 4. Forum Topic / Thread inside supergroup
    const threadUpdate: TelegramUpdate = {
      update_id: 104,
      message: {
        message_id: 4,
        message_thread_id: 42,
        date: 1700000003,
        chat: { id: -9999, type: "supergroup", title: "Forum Community", is_forum: true },
        from: { id: 777, first_name: "Charlie", is_bot: false },
        text: "Thread topic discussion",
      },
    };
    const threadInput = world.ingestUpdate(threadUpdate);
    expect(threadInput?.partId).toBe("thread:-9999:42");

    // Verify all parts are discovered and registered
    const parts = world.listParts();
    expect(parts.length).toBe(4);
    expect(parts.find((p) => p.id === "channel:-1001234")?.type).toBe("channel");
    expect(parts.find((p) => p.id === "dm:987")?.type).toBe("dm");
    expect(parts.find((p) => p.id === "group:-5678")?.type).toBe("group");
    expect(parts.find((p) => p.id === "thread:-9999:42")?.type).toBe("thread");

    handle.dispose();
  });

  it("ingests updates via router webhook endpoint (POST)", async () => {
    const world = new TelegramWorld({ passive: true, env: mockEnv });
    const handle = world.start(ctx);

    const webhookUpdate: TelegramUpdate = {
      update_id: 201,
      message: {
        message_id: 55,
        date: 1700000010,
        chat: { id: -1234, type: "group", title: "Webhook Group" },
        from: { id: 111, first_name: "Dave" },
        text: "Message sent via webhook",
      },
    };

    const webhookRes = await router.read<{ ok: boolean; inputId?: string }>(
      "/world/telegram/webhook",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookUpdate),
      },
    );

    expect(webhookRes.ok).toBe(true);
    expect(webhookRes.inputId).toBe("tg-msg--1234-55");

    // Read message back from router messages endpoint
    const msg = await router.read<{ id: string; content: string }>(
      "/world/telegram/messages/tg-msg--1234-55",
    );
    expect(msg.content).toBe("Message sent via webhook");

    // Verify GET webhook health status
    const getRes = await router.read<{ ok: boolean; status: string }>("/world/telegram/webhook");
    expect(getRes.ok).toBe(true);
    expect(getRes.status).toBe("webhook active");

    handle.dispose();
  });

  it("ingests and normalizes MTProto updates", async () => {
    const world = new TelegramWorld({ passive: true, env: mockEnv });
    const handle = world.start(ctx);

    const mtprotoUpdate: RawMtprotoUpdate = {
      _: "updateNewChannelMessage",
      message: {
        id: 88,
        peerId: { _: "peerChannel", channelId: 10099 },
        fromId: { _: "peerUser", userId: 444 },
        date: 1700000020,
        message: "MTProto synchronized update",
      },
    };

    const input = world.ingestMtprotoUpdate(mtprotoUpdate);
    expect(input).not.toBeNull();
    expect(input?.world).toBe("telegram");
    expect(input?.partId).toBe("channel:10099");
    expect(input?.content).toBe("MTProto synchronized update");

    handle.dispose();
  });

  it("deduplicates already-seen updates", () => {
    const world = new TelegramWorld({ dbPath: ":memory:", passive: true, env: mockEnv });
    world.start(ctx);

    const update: TelegramUpdate = {
      update_id: 301,
      message: {
        message_id: 99,
        date: 1700000030,
        chat: { id: 123, type: "private" },
        from: { id: 123, first_name: "Eve" },
        text: "Unique message",
      },
    };

    const first = world.ingestUpdate(update);
    expect(first).not.toBeNull();

    const duplicate = world.ingestUpdate(update);
    expect(duplicate).toBeNull();

    world.dispose();
  });

  it("filters out messages sent by the bot itself to prevent feedback loops", () => {
    const world = new TelegramWorld({
      botId: 99999,
      botUsername: "MyBot",
      passive: true,
      env: mockEnv,
    });
    world.start(ctx);

    const botSelfMsg: TelegramUpdate = {
      update_id: 401,
      message: {
        message_id: 1,
        date: 1700000040,
        chat: { id: 123, type: "private" },
        from: { id: 99999, first_name: "MyBot", is_bot: true, username: "MyBot" },
        text: "Self message",
      },
    };

    expect(world.ingestUpdate(botSelfMsg)).toBeNull();
    world.dispose();
  });

  it("coalesces burst inputs transactionally and formats into XML payload", async () => {
    const world = new TelegramWorld({ passive: true, env: mockEnv });
    world.start(ctx);

    const batches: Array<ReadonlyArray<any>> = [];
    inputBatcher.onBatch((batch) => {
      batches.push(batch);
    });

    // Ingest two consecutive messages in channel:1234
    world.ingestUpdate({
      update_id: 501,
      message: {
        message_id: 11,
        date: 1700000050,
        chat: { id: 1234, type: "channel" },
        from: { id: 222, first_name: "爱<你" },
        text: "Will there be a meteor shower tonight?",
      },
    });

    world.ingestUpdate({
      update_id: 502,
      message: {
        message_id: 12,
        date: 1700000051,
        chat: { id: 1234, type: "channel" },
        from: { id: 222, first_name: "爱<你" },
        text: "Shall we go watch it together?",
      },
    });

    // Wait for debounce flush
    await new Promise((r) => setTimeout(r, 80));

    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(2);

    const xml = formatBatchToXml(batches[0]);
    expect(xml).toContain("<World>telegram</World>");
    expect(xml).toContain("<Channel>channel:1234</Channel>");
    expect(xml).toContain("<Name>爱&lt;你</Name>");
    expect(xml).toContain(
      '<Message id="tg-msg-1234-11">Will there be a meteor shower tonight?</Message>',
    );
    expect(xml).toContain('<Message id="tg-msg-1234-12">Shall we go watch it together?</Message>');

    world.dispose();
  });
});

describe("TelegramWorld - Action Node (node-mw7rp4py-6f39)", () => {
  let router: SimpleEmaRouter;
  let inputBatcher: SimpleEmaInputBatcher;
  let ctx: EmaCtx;
  const mockEnv = { PENGUIN_AGENT_ID: "emafanclub_ema_dev" };
  const mockActor: EmaActor = {
    id: "actor-ema-companion",
    name: "Ema Companion",
    session: "session-2026-11-08-test",
    agentId: "emafanclub_ema_dev",
  };

  beforeEach(() => {
    router = new SimpleEmaRouter();
    inputBatcher = new SimpleEmaInputBatcher({ dbPath: ":memory:" });
    const regMap = new Map();
    ctx = {
      router,
      inputBatcher,
      registry: {
        register: (name, w) => {
          regMap.set(name, w);
          return { dispose: () => regMap.delete(name) };
        },
        get: (name) => regMap.get(name),
        list: () => [...regMap.entries()].map(([name, world]) => ({ name, world })),
      },
    };
  });

  describe("MarkdownV2 Formatting Helpers", () => {
    it("escapes all 18 MarkdownV2 special characters", () => {
      const allSpecials = "_ * [ ] ( ) ~ ` > # + - = | { } . ! \\";
      const escaped = escapeMarkdownV2(allSpecials);
      expect(escaped).toBe(
        "\\_ \\* \\[ \\] \\( \\) \\~ \\` \\> \\# \\+ \\- \\= \\| \\{ \\} \\. \\! \\\\",
      );
    });

    it("formats text with helper tags", () => {
      expect(mdV2Bold("Hello")).toBe("*Hello*");
      expect(mdV2Italic("world")).toBe("_world_");
      expect(mdV2Code("const a = 1;")).toBe("`const a = 1;`");
      expect(mdV2Pre("code block", "ts")).toBe("```ts\ncode block\n```");
      expect(mdV2Link("Ema", "https://ema.ai")).toBe("[Ema](https://ema.ai)");
      expect(mdV2Spoiler("secret")).toBe("||secret||");
      expect(mdV2Strikethrough("deleted")).toBe("~deleted~");
      expect(mdV2Underline("underline")).toBe("__underline__");
    });
  });

  describe("Action Dispatcher Execution", () => {
    it("dispatches simple text reply and records action", async () => {
      const dispatched: TelegramActionPayload[] = [];
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: (payload) => {
          dispatched.push(payload);
          return {
            id: "act-01",
            targetPartId: payload.targetPartId,
            chatId: payload.chatId,
            action: payload.action,
            actor: payload.actor,
            timestamp: payload.timestamp,
            status: "dispatched",
          };
        },
      });
      world.start(ctx);

      world.interact(ctx, mockActor, "channel:1234", "reply", "Direct response from Ema");

      expect(dispatched.length).toBe(1);
      expect(dispatched[0].chatId).toBe("1234");
      expect(dispatched[0].action.action).toBe("reply");
      expect((dispatched[0].action as any).text).toBe("Direct response from Ema");

      const actions = await router.read<Array<{ id: string }>>("/world/telegram/actions");
      expect(actions.length).toBe(1);
      expect(actions[0].id).toBe("act-01");

      world.dispose();
    });

    it("delivers MarkdownV2 formatted message with inline keyboard buttons", () => {
      const dispatched: TelegramActionPayload[] = [];
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: (payload) => {
          dispatched.push(payload);
        },
      });
      world.start(ctx);

      const buttons = [
        [
          { text: "Confirm", callback_data: "confirm_yes" },
          { text: "Cancel", callback_data: "cancel_no" },
        ],
        [{ text: "Docs", url: "https://ema.ai/docs" }],
      ];

      world.interact(ctx, mockActor, "group:5678", {
        action: "sendMessage",
        text: `*${escapeMarkdownV2("Welcome to Ema!")}* \\- lifelong companion\\.`,
        parse_mode: "MarkdownV2",
        reply_markup: inlineKeyboard(buttons),
      });

      expect(dispatched.length).toBe(1);
      const act = dispatched[0].action as any;
      expect(act.parse_mode).toBe("MarkdownV2");
      expect(act.reply_markup.inline_keyboard.length).toBe(2);
      expect(act.reply_markup.inline_keyboard[0][0].callback_data).toBe("confirm_yes");

      world.dispose();
    });

    it("dispatches rich media and card actions", () => {
      const dispatched: TelegramActionPayload[] = [];
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: (payload) => {
          dispatched.push(payload);
        },
      });
      world.start(ctx);

      // 1. sendPhoto
      world.interact(ctx, mockActor, "channel:1234", {
        action: "sendPhoto",
        photo: "https://example.com/avatar.png",
        caption: "Ema avatar",
      });

      // 2. sendCard
      world.interact(ctx, mockActor, "dm:987", {
        action: "sendCard",
        title: "Memory Milestone",
        description: "You reached 100 days with Ema.",
        mediaUrl: "https://example.com/milestone.jpg",
        mediaType: "photo",
        buttons: [[{ text: "Celebrate", callback_data: "celebrate" }]],
      });

      expect(dispatched.length).toBe(2);
      expect(dispatched[0].action.action).toBe("sendPhoto");
      expect((dispatched[0].action as any).photo).toBe("https://example.com/avatar.png");

      expect(dispatched[1].action.action).toBe("sendCard");
      expect((dispatched[1].action as any).title).toBe("Memory Milestone");
      expect((dispatched[1].action as any).buttons[0][0].text).toBe("Celebrate");

      world.dispose();
    });

    it("dispatches emoji reactions (setMessageReaction)", () => {
      const dispatched: TelegramActionPayload[] = [];
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: (payload) => {
          dispatched.push(payload);
        },
      });
      world.start(ctx);

      // Single emoji reaction using string shorthand
      world.interact(ctx, mockActor, "group:5678", "react", "🔥", "tg-msg-5678-101");

      // Multiple emoji reaction using object payload
      world.interact(ctx, mockActor, "group:5678", {
        action: "react",
        emoji: ["❤️", "👍"],
        messageId: 102,
        isBig: true,
      });

      expect(dispatched.length).toBe(2);
      expect(dispatched[0].action.action).toBe("react");
      expect((dispatched[0].action as any).emoji).toBe("🔥");
      expect((dispatched[0].action as any).messageId).toBe(101);

      expect(dispatched[1].action.action).toBe("react");
      expect((dispatched[1].action as any).emoji).toEqual(["❤️", "👍"]);
      expect((dispatched[1].action as any).messageId).toBe(102);
      expect((dispatched[1].action as any).isBig).toBe(true);

      world.dispose();
    });

    it("dispatches replies targeting specific threads and quotes", () => {
      const dispatched: TelegramActionPayload[] = [];
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: (payload) => {
          dispatched.push(payload);
        },
      });
      world.start(ctx);

      // Reply directly to thread part: thread:5678:42
      world.interact(ctx, mockActor, "thread:5678:42", "reply", "Reply in thread");

      // Reply with explicit replyTo message quote and thread ID
      world.interact(ctx, mockActor, "group:5678", {
        action: "reply",
        text: "Quoting message 77",
        replyTo: "tg-msg-5678-77",
        messageThreadId: 42,
      });

      expect(dispatched.length).toBe(2);
      expect(dispatched[0].chatId).toBe("5678");
      expect((dispatched[0].action as any).message_thread_id).toBe(42);

      expect(dispatched[1].chatId).toBe("5678");
      expect((dispatched[1].action as any).messageThreadId).toBe(42);
      expect((dispatched[1].action as any).replyTo).toBe(77);

      world.dispose();
    });

    it("handles action dispatcher failure gracefully and records failed status", async () => {
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: () => {
          throw new Error("Telegram API network timeout (429 Too Many Requests)");
        },
      });
      world.start(ctx);

      // Does not crash interact caller
      expect(() => {
        world.interact(ctx, mockActor, "channel:1234", "reply", "Attempt message");
      }).not.toThrow();

      const actions =
        await router.read<Array<{ status: string; error?: string; targetPartId: string }>>(
          "/world/telegram/actions",
        );

      expect(actions.length).toBe(1);
      expect(actions[0].status).toBe("failed");
      expect(actions[0].error).toContain("Telegram API network timeout");

      world.dispose();
    });

    it("handles async rejected action dispatcher promise gracefully", async () => {
      const world = new TelegramWorld({
        passive: true,
        env: mockEnv,
        actionDispatcher: async () => {
          throw new Error("Async Telegram connection refused");
        },
      });
      world.start(ctx);

      world.interact(ctx, mockActor, "channel:1234", "reply", "Async attempt");

      // Allow microtask to settle
      await new Promise((r) => setTimeout(r, 20));

      const actions =
        await router.read<Array<{ status: string; error?: string }>>("/world/telegram/actions");
      expect(actions.length).toBe(1);
      expect(actions[0].status).toBe("failed");
      expect(actions[0].error).toContain("Async Telegram connection refused");

      world.dispose();
    });
  });

  describe("End-to-End & Advanced Features", () => {
    it("runs active polling loop with offset tracking", async () => {
      let polledOffset = 0;
      const fakeUpdates: TelegramUpdate[] = [
        {
          update_id: 1000,
          message: {
            message_id: 1,
            date: 1700001000,
            chat: { id: 888, type: "private" },
            from: { id: 888, first_name: "PolledUser" },
            text: "Polled message 1",
          },
        },
        {
          update_id: 1001,
          message: {
            message_id: 2,
            date: 1700001001,
            chat: { id: 888, type: "private" },
            from: { id: 888, first_name: "PolledUser" },
            text: "Polled message 2",
          },
        },
      ];

      const world = new TelegramWorld({
        mode: "polling",
        passive: false,
        pollInterval: 30,
        env: mockEnv,
        updateFetcher: async (offset) => {
          polledOffset = offset;
          if (offset === 0) return fakeUpdates;
          return [];
        },
      });

      const handle = world.start(ctx);

      // Wait for poll execution
      await new Promise((r) => setTimeout(r, 60));

      expect(polledOffset).toBe(1002);

      const msgs = await router.read<Array<{ id: string }>>("/world/telegram/messages");
      expect(msgs.length).toBe(2);

      handle.dispose();
    });

    it("persists seen state across instances using file-based SQLite database", () => {
      const tempDbPath = `/tmp/test-tg-state-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`;

      // Instance 1: ingests update
      const world1 = new TelegramWorld({ dbPath: tempDbPath, passive: true, env: mockEnv });
      world1.start(ctx);

      const update: TelegramUpdate = {
        update_id: 999,
        message: {
          message_id: 42,
          date: 1700002000,
          chat: { id: 777, type: "group" },
          from: { id: 333, first_name: "PersistTester" },
          text: "Message to persist",
        },
      };

      const res1 = world1.ingestUpdate(update);
      expect(res1).not.toBeNull();
      world1.dispose();

      // Instance 2: starts with same dbPath -> should already know the message was seen
      const world2 = new TelegramWorld({ dbPath: tempDbPath, passive: true, env: mockEnv });
      world2.start(ctx);

      const res2 = world2.ingestUpdate(update);
      expect(res2).toBeNull(); // Skipped as already seen

      world2.dispose();

      // Cleanup temp db
      try {
        import("node:fs").then((fs) => {
          fs.unlinkSync(tempDbPath);
        });
      } catch {}
    });

    it("handles media updates: stickers, photos, documents, and callback queries", () => {
      const world = new TelegramWorld({ passive: true, env: mockEnv });
      world.start(ctx);

      // Sticker message
      const stickerIn = world.ingestUpdate({
        update_id: 801,
        message: {
          message_id: 81,
          date: 1700003001,
          chat: { id: 501, type: "private" },
          from: { id: 501, first_name: "StickerUser" },
          sticker: { file_id: "stk_123", emoji: "🎉" },
        },
      });
      expect(stickerIn?.content).toBe("[Sticker: 🎉]");

      // Document message
      const docIn = world.ingestUpdate({
        update_id: 802,
        message: {
          message_id: 82,
          date: 1700003002,
          chat: { id: 502, type: "private" },
          from: { id: 502, first_name: "DocUser" },
          document: { file_id: "doc_456", file_name: "report.pdf" },
        },
      });
      expect(docIn?.content).toBe("[Document: report.pdf]");

      // Inline button callback query
      const btnIn = world.ingestUpdate({
        update_id: 803,
        callback_query: {
          id: "cb_999",
          from: { id: 503, first_name: "BtnUser", is_bot: false },
          message: {
            message_id: 83,
            date: 1700003003,
            chat: { id: 503, type: "private" },
          },
          data: "select_option_a",
        },
      });
      expect(btnIn?.content).toBe("[Button: select_option_a]");

      world.dispose();
    });
  });
});
