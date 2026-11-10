/**
 * @prism-shadow/ema - QQ @Mention Detection, Message Synchronization & Gap Perception Tests
 *
 * Verifies:
 * 1. @ Mention Detection:
 *    - Parses [CQ:at,qq=...] and OneBot segment array { type: "at", data: { qq: ... } }
 *    - Accurately detects isAtMe, isAtAll, and atUids list
 *    - Detects text-based nickname mentions (@小纸夜, @Ema)
 *    - Detects quote replies to the bot's own prior messages (isReplyToMe)
 * 2. Group Mention Filtering:
 *    - When requireMentionInGroups = true, only @mentions / replies trigger inputBatcher turns
 *    - Ambient group chatter is still 100% synchronized to local SQLite and channel items
 * 3. Message Synchronization to Local SQLite:
 *    - Pulls group message history from OneBot 11 gateway via get_group_msg_history
 *    - Persists into seen_qq_synced_messages and seen_qq_sync_state
 *    - Enables local offline querying via /world/qq/sync/messages and channel items
 * 4. Sequence Gap Perception & Auto-Recovery:
 *    - Monitors monotonic message_seq progression per group
 *    - Detects dropped/missed message windows when seq jumps
 *    - Automatically fetches and backfills missing messages via get_group_msg_history
 *    - Telemetry exposed via /world/qq/sync/status and /world/qq/sync/gaps
 * 5. Introspectable Actions:
 *    - sync.refresh and sync.status actions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  QQWorld,
  parseCQMessage,
  parseSegmentMessage,
  parseMentionInfo,
  QQMessageSynchronizer,
  cleanLlmReplyText,
  createQQCompanionRunner,
  SimpleEmaRouter,
  type EmaCtx,
  type EmaInput,
  type OneBotEvent,
  type OneBotApiCall,
  type OneBotApiResponse,
} from "../src/index.js";

describe("QQ World - @Mention Parsing & Detection", () => {
  const BOT_UID = "1000000001";
  const NICKNAMES = ["小纸夜", "Ema"];

  it("detects CQ:at mentions targeting the bot (isAtMe: true)", () => {
    const raw = `[CQ:at,qq=${BOT_UID}] 你好呀小纸夜！`;
    const parsed = parseCQMessage(raw, BOT_UID, NICKNAMES);

    expect(parsed.metadata.isAtMe).toBe(true);
    expect(parsed.metadata.isAtAll).toBe(false);
    expect(parsed.metadata.atUids).toEqual([BOT_UID]);
    expect(parsed.content).toBe(`@${BOT_UID} 你好呀小纸夜！`);
  });

  it("detects CQ:at mentions targeting other users (isAtMe: false)", () => {
    const raw = `[CQ:at,qq=99887766] 请看一下群公告`;
    const parsed = parseCQMessage(raw, BOT_UID, NICKNAMES);

    expect(parsed.metadata.isAtMe).toBe(false);
    expect(parsed.metadata.isAtAll).toBe(false);
    expect(parsed.metadata.atUids).toEqual(["99887766"]);
  });

  it("detects [CQ:at,qq=all] broadcast mentions", () => {
    const raw = `[CQ:at,qq=all] 全体成员注意今晚有测试`;
    const parsed = parseCQMessage(raw, BOT_UID, NICKNAMES);

    expect(parsed.metadata.isAtAll).toBe(true);
    expect(parsed.metadata.atUids).toContain("all");
  });

  it("detects segment array @mentions targeting the bot", () => {
    const segments = [
      { type: "at", data: { qq: BOT_UID } },
      { type: "text", data: { text: " 请问今天有什么计划？" } },
    ];
    const parsed = parseSegmentMessage(segments, BOT_UID, NICKNAMES);

    expect(parsed.metadata.isAtMe).toBe(true);
    expect(parsed.metadata.atUids).toEqual([BOT_UID]);
    expect(parsed.content).toContain(`@${BOT_UID}`);
  });

  it("detects text-based nickname mentions without CQ code", () => {
    const rawText = "大家好，特别是 @小纸夜 早上好！";
    const parsed = parseCQMessage(rawText, BOT_UID, NICKNAMES);

    expect(parsed.metadata.isAtMe).toBe(true);
  });
});

describe("QQ World - Group Message Synchronization & Local Storage", () => {
  const GROUP_ID = "2000000001";
  const BOT_UID = "1000000001";
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
  });

  it("synchronizes group history and stores messages into SQLite", async () => {
    const mockMessages = [
      {
        message_id: 1001,
        message_seq: 50,
        group_id: Number(GROUP_ID),
        user_id: 111222,
        time: 1700000000,
        raw_message: "群里有人在吗？",
        sender: { user_id: 111222, nickname: "Alice", card: "爱丽丝" },
      },
      {
        message_id: 1002,
        message_seq: 51,
        group_id: Number(GROUP_ID),
        user_id: 333444,
        time: 1700000005,
        raw_message: `[CQ:at,qq=${BOT_UID}] 在的在的，@Ema 请出来一下~`,
        sender: { user_id: 333444, nickname: "Bob" },
      },
    ];

    const mockCaller = vi.fn(async (call: OneBotApiCall): Promise<OneBotApiResponse> => {
      if (call.action === "get_group_msg_history") {
        return {
          status: "ok",
          retcode: 0,
          data: { messages: mockMessages },
        };
      }
      return { status: "ok", retcode: 0 };
    });

    const ingested: EmaInput[] = [];
    const synchronizer = new QQMessageSynchronizer({
      apiCaller: mockCaller,
      db,
      groups: [GROUP_ID],
      selfId: BOT_UID,
      nicknames: ["小纸夜", "Ema"],
      onMessage: (msg) => {
        ingested.push({
          id: msg.messageId,
          world: "qq",
          partId: `group:${msg.groupId}`,
          sender: { id: `user:qq:${msg.userId}`, name: msg.senderName },
          content: msg.content,
          timestamp: msg.timestamp,
          metadata: { isAtMe: msg.isAtMe, atUids: msg.atUids, messageSeq: msg.messageSeq },
        });
      },
    });

    const syncedCount = await synchronizer.syncGroup(GROUP_ID);
    expect(syncedCount).toBe(2);
    expect(ingested.length).toBe(2);

    // Verify first message (ambient chatter)
    expect(ingested[0].id).toBe("1001");
    expect(ingested[0].metadata?.isAtMe).toBe(false);

    // Verify second message (@ mention)
    expect(ingested[1].id).toBe("1002");
    expect(ingested[1].metadata?.isAtMe).toBe(true);

    // Verify SQLite local persistence
    const localMsgs = synchronizer.getSyncedMessages(GROUP_ID);
    expect(localMsgs.length).toBe(2);
    expect(localMsgs[0].messageSeq).toBe(50);
    expect(localMsgs[1].messageSeq).toBe(51);

    // Query with filter: atMeOnly
    const atMeMsgs = synchronizer.getSyncedMessages(GROUP_ID, { atMeOnly: true });
    expect(atMeMsgs.length).toBe(1);
    expect(atMeMsgs[0].messageId).toBe("1002");

    // Verify Sync Status
    const status = synchronizer.getSyncStatus();
    expect(status.groups[GROUP_ID].totalSynced).toBe(2);
    expect(status.groups[GROUP_ID].lastSeq).toBe(51);
    expect(status.groups[GROUP_ID].gapsDetected).toBe(0);
  });
});

describe("QQ World - Sequence Gap Perception & Auto-Recovery", () => {
  const GROUP_ID = "2000000001";
  const BOT_UID = "1000000001";
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
  });

  it("perceives sequence gaps and recovers missing messages", async () => {
    let mockRound = 1;
    const gapEvents: any[] = [];

    const mockCaller = vi.fn(async (call: OneBotApiCall): Promise<OneBotApiResponse> => {
      if (call.action === "get_group_msg_history") {
        const params = call.params || {};

        // Gap recovery request
        if (params.message_seq === 100) {
          return {
            status: "ok",
            retcode: 0,
            data: {
              messages: [
                {
                  message_id: 2002,
                  message_seq: 101,
                  group_id: Number(GROUP_ID),
                  user_id: 555666,
                  time: 1700000010,
                  raw_message: "丢失消息 1: 讨论架构",
                  sender: { user_id: 555666, nickname: "Charlie" },
                },
                {
                  message_id: 2003,
                  message_seq: 102,
                  group_id: Number(GROUP_ID),
                  user_id: 555666,
                  time: 1700000015,
                  raw_message: `[CQ:at,qq=${BOT_UID}] 丢失消息 2: @Ema 你在吗`,
                  sender: { user_id: 555666, nickname: "Charlie" },
                },
              ],
            },
          };
        }

        // Regular poll round 1: messages 100
        if (mockRound === 1) {
          return {
            status: "ok",
            retcode: 0,
            data: {
              messages: [
                {
                  message_id: 2001,
                  message_seq: 100,
                  group_id: Number(GROUP_ID),
                  user_id: 111222,
                  time: 1700000000,
                  raw_message: "初始消息",
                  sender: { user_id: 111222, nickname: "Alice" },
                },
              ],
            },
          };
        }

        // Regular poll round 2: sequence jumped from 100 to 103! (101 and 102 missing)
        if (mockRound === 2) {
          return {
            status: "ok",
            retcode: 0,
            data: {
              messages: [
                {
                  message_id: 2004,
                  message_seq: 103,
                  group_id: Number(GROUP_ID),
                  user_id: 777888,
                  time: 1700000030,
                  raw_message: "跳号之后的消息",
                  sender: { user_id: 777888, nickname: "David" },
                },
              ],
            },
          };
        }
      }
      return { status: "ok", retcode: 0 };
    });

    const synchronizer = new QQMessageSynchronizer({
      apiCaller: mockCaller,
      db,
      groups: [GROUP_ID],
      selfId: BOT_UID,
      nicknames: ["Ema"],
      autoRecoverGaps: true,
      onGap: (gap) => gapEvents.push(gap),
    });

    // Round 1: establishes lastSeq = 100
    mockRound = 1;
    await synchronizer.syncGroup(GROUP_ID);
    expect(synchronizer.getSyncStatus().groups[GROUP_ID].lastSeq).toBe(100);

    // Round 2: receives seq 103 (gap detected: expected 101, got 103 -> missed 2)
    mockRound = 2;
    await synchronizer.syncGroup(GROUP_ID);

    // Verify gap event recorded
    expect(gapEvents.length).toBe(1);
    expect(gapEvents[0].fromSeq).toBe(101);
    expect(gapEvents[0].toSeq).toBe(102);
    expect(gapEvents[0].missedCount).toBe(2);

    // Verify telemetry
    const status = synchronizer.getSyncStatus();
    expect(status.groups[GROUP_ID].gapsDetected).toBe(1);
    expect(status.groups[GROUP_ID].messagesMissed).toBe(2);
    expect(status.groups[GROUP_ID].messagesRecovered).toBe(2);
    expect(status.summary.totalMessagesRecovered).toBe(2);
    expect(status.summary.hasActiveGaps).toBe(false);

    // Verify all 4 messages exist in local storage in correct sequence order
    const localMsgs = synchronizer.getSyncedMessages(GROUP_ID);
    expect(localMsgs.length).toBe(4);
    expect(localMsgs.map((m) => m.messageSeq)).toEqual([100, 101, 102, 103]);

    // Verify the recovered missed message with @ mention was marked isAtMe
    const missedMention = localMsgs.find((m) => m.messageSeq === 102);
    expect(missedMention?.isAtMe).toBe(true);
  });
});

describe("QQ World - requireMentionInGroups Option & Route Endpoints", () => {
  const GROUP_ID = "2000000001";
  const BOT_UID = "1000000001";

  it("only pushes group messages to inputBatcher when @mentioned if requireMentionInGroups is true", async () => {
    const pushedInputs: EmaInput[] = [];
    const router = new SimpleEmaRouter();
    const ctx: EmaCtx = {
      router,
      inputBatcher: {
        push: (input) => pushedInputs.push(input),
        onBatch: () => ({ dispose: () => {} }),
      },
      registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
    };

    const world = new QQWorld({
      selfId: BOT_UID,
      allowedGroups: [GROUP_ID],
      requireMentionInGroups: true, // Only trigger on mentions!
      nicknames: ["小纸夜", "Ema"],
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    const handle = world.start(ctx);
    try {
      // 1. Ambient group message without mention
      const ambientEvent: OneBotEvent = {
        post_type: "message",
        message_type: "group",
        sub_type: "normal",
        message_id: 3001,
        message_seq: 201,
        group_id: Number(GROUP_ID),
        user_id: 111222,
        time: 1700000000,
        raw_message: "普通群友在聊天，没有艾特任何人",
        sender: { user_id: 111222, nickname: "Alice" },
      };
      await world.ingestEvent(ambientEvent);

      // Should NOT be pushed to batcher because there is no mention!
      expect(pushedInputs.length).toBe(0);

      // But it MUST be saved to local social channel items!
      const channelItems = world.listSocialItems(`qq:group:${GROUP_ID}`);
      expect(channelItems.length).toBe(1);
      expect(channelItems[0].id).toBe("3001");

      // 2. Group message with @mention
      const mentionEvent: OneBotEvent = {
        post_type: "message",
        message_type: "group",
        sub_type: "normal",
        message_id: 3002,
        message_seq: 202,
        group_id: Number(GROUP_ID),
        user_id: 333444,
        time: 1700000005,
        raw_message: `[CQ:at,qq=${BOT_UID}] 小纸夜，能帮我查一下资料吗？`,
        sender: { user_id: 333444, nickname: "Bob" },
      };
      await world.ingestEvent(mentionEvent);

      // Should be pushed to batcher because isAtMe is true!
      expect(pushedInputs.length).toBe(1);
      expect(pushedInputs[0].id).toBe("3002");
      expect((pushedInputs[0].metadata as any).isAtMe).toBe(true);
    } finally {
      handle.dispose();
      world.dispose();
    }
  });

  it("exposes sync status and introspectable sync actions", async () => {
    const router = new SimpleEmaRouter();
    const ctx: EmaCtx = {
      router,
      inputBatcher: { push: () => {}, onBatch: () => ({ dispose: () => {} }) },
      registry: { register: () => ({ dispose: () => {} }), get: () => undefined, list: () => [] },
    };

    const world = new QQWorld({
      selfId: BOT_UID,
      allowedGroups: [GROUP_ID],
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    const handle = world.start(ctx);
    try {
      // Introspect action list
      const actions = world.listActions();
      const syncRefreshAction = actions.find((a) => a.name === "sync.refresh");
      const syncStatusAction = actions.find((a) => a.name === "sync.status");
      expect(syncRefreshAction).toBeDefined();
      expect(syncStatusAction).toBeDefined();

      // Execute sync.status action
      const statusRes = await world.executeAction("sync.status", {});
      expect(statusRes.status).toBe("ok");
      expect(statusRes.sync).toBeDefined();

      // Execute sync.refresh action
      const refreshRes = await world.executeAction("sync.refresh", {});
      expect(refreshRes.status).toBe("ok");
    } finally {
      handle.dispose();
      world.dispose();
    }
  });

  it("cleans raw penguin run stdout into clean companion response", () => {
    const rawStdout = `
PenguinHarness run v0.2.18-g4f741de
Agent: aoi_rei
Workspace: /home/rei/work/org/ema/ema-dev
Model: gemini-3.8-flash
Server: http://localhost:17469
**Analyzing User Input**

I'm currently scrutinizing the user's input, specifically their greeting. My priority is to ascertain if this is a standard direct chat message or if it carries any specific channel implications.


你好呀。今天过得还好吗？如果有什么想聊的，我一直都在这里听你说。
[stats] context 8k (+8k) · tokens 8k (+8k) · 4.7s (+4.7s)
    `;

    const cleaned = cleanLlmReplyText(rawStdout);
    expect(cleaned).toBe("你好呀。今天过得还好吗？如果有什么想聊的，我一直都在这里听你说。");
  });

  it("boots QQ companion runner and handles an @mention turn round-trip", async () => {
    let capturedReply = "";
    let capturedTarget = "";

    const runner = createQQCompanionRunner({
      gatewayUrl: "http://mock-gateway:13000",
      groupId: "2000000001",
      selfId: BOT_UID,
      nicknames: ["小纸夜", "Ema"],
      requireMentionInGroups: true,
      dbPath: ":memory:",
      llmInvoker: async (prompt, batch) => {
        expect(prompt).toContain("Ema 同好会");
        expect(prompt).toContain("测试群友");
        return "收到你的艾特啦，测试一切正常 ✨";
      },
      env: { PENGUIN_AGENT_ID: "emafanclub_ema_dev" },
    });

    try {
      // Mock the interact method on runner.world
      const originalInteract = runner.world.interact.bind(runner.world);
      vi.spyOn(runner.world, "interact").mockImplementation((ctx, actor, target, payload: any) => {
        capturedTarget = target;
        capturedReply = payload.text;
        return { dispose: () => {} };
      });

      // Ingest an @mention message
      const mentionEvent: OneBotEvent = {
        post_type: "message",
        message_type: "group",
        sub_type: "normal",
        message_id: 88888,
        message_seq: 301,
        group_id: 2000000001,
        user_id: 123456,
        time: 1700000000,
        raw_message: `[CQ:at,qq=${BOT_UID}] @Ema 你好！`,
        sender: { user_id: 123456, nickname: "测试群友" },
      };

      await runner.world.ingestEvent(mentionEvent);

      // Await turn debounce and execution
      await new Promise((r) => setTimeout(r, 800));

      expect(capturedTarget).toBe("group:2000000001");
      expect(capturedReply).toBe("收到你的艾特啦，测试一切正常 ✨");
    } finally {
      runner.dispose();
    }
  });
});
