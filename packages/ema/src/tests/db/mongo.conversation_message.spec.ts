import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoConversationMessageDB } from "../../db";
import type { Mongo } from "../../db";

describe("MongoConversationMessageDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoConversationMessageDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoConversationMessageDB(mongo);
  });

  afterEach(async () => {
    await mongo.close();
  });

  test("should list empty messages initially", async () => {
    const messages = await db.listConversationMessages({});
    expect(messages).toEqual([]);
  });

  test("should add a user conversation message", async () => {
    const createdAt = Date.now();
    const stored = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt,
    });

    expect(stored.id).toBe(1);
    expect(stored.msgId).toBe(1);
    const retrievedMessage = await db.getConversationMessage(1);
    expect(retrievedMessage).toEqual(stored);
  });

  test("should persist actor inner thought separately", async () => {
    const stored = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "actor",
        name: "EMA",
        contents: [{ type: "text", text: "Hi there!" }],
        think: "Keep the tone warm and friendly.",
      },
      createdAt: Date.now(),
    });

    const retrievedMessage = await db.getConversationMessage(1);
    expect(retrievedMessage).toEqual(stored);
  });

  test("should assign conversation-scoped msgIds sequentially", async () => {
    const first = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    });
    const second = await db.addConversationMessage({
      conversationId: 2,
      actorId: 1,
      message: {
        kind: "actor",
        name: "EMA",
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
    });
    const third = await db.addConversationMessage({
      conversationId: 2,
      actorId: 2,
      message: {
        kind: "user",
        uid: "user-2",
        name: "bob",
        contents: [{ type: "text", text: "How are you?" }],
      },
      createdAt: Date.now(),
    });

    expect(first.msgId).toBe(1);
    expect(second.msgId).toBe(1);
    expect(third.msgId).toBe(2);
  });

  test("should delete a conversation message", async () => {
    await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    });
    const deleted = await db.deleteConversationMessage(1);
    expect(deleted).toBe(true);

    const retrievedMessage = await db.getConversationMessage(1);
    expect(retrievedMessage).toBeNull();
  });

  test("should update channelMessageId by conversationId and msgId", async () => {
    const stored = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      channelMessageId: "temp:1",
      message: {
        kind: "actor",
        name: "EMA",
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
      msgId: 1,
    });

    const updated = await db.updateConversationMessageChannelMessageId(
      1,
      1,
      "99887766",
    );
    expect(updated).toBe(true);

    const row = await db.getConversationMessage(stored.id);
    expect(row?.channelMessageId).toBe("99887766");
  });

  test("should filter messages by resumed state", async () => {
    const legacy = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "legacy" }],
      },
      createdAt: Date.now(),
    });
    const pending = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      resumed: false,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "pending" }],
      },
      createdAt: Date.now(),
    });
    const resumed = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      resumed: true,
      message: {
        kind: "actor",
        name: "EMA",
        contents: [{ type: "text", text: "done" }],
      },
      createdAt: Date.now(),
    });

    const visible = await db.listConversationMessages({
      conversationId: 1,
      resumed: true,
      sort: "asc",
    });
    expect(visible).toEqual([legacy, resumed]);

    const hidden = await db.listConversationMessages({
      conversationId: 1,
      resumed: false,
      sort: "asc",
    });
    expect(hidden).toEqual([pending]);
  });

  test("should mark selected messages as resumed", async () => {
    const first = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      resumed: false,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "first" }],
      },
      createdAt: Date.now(),
    });
    const second = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      resumed: false,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "second" }],
      },
      createdAt: Date.now(),
    });

    const updated = await db.markConversationMessagesResumed(1, [second.msgId]);
    expect(updated).toBe(1);

    const visible = await db.listConversationMessages({
      conversationId: 1,
      resumed: true,
      sort: "asc",
    });
    expect(visible).toEqual([{ ...second, resumed: true }]);

    const pending = await db.listConversationMessages({
      conversationId: 1,
      resumed: false,
      sort: "asc",
    });
    expect(pending).toEqual([first]);
  });

  test("should list messages filtered by conversationId", async () => {
    const msg1 = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    });
    const msg2 = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "actor",
        name: "EMA",
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
    });
    await db.addConversationMessage({
      conversationId: 2,
      actorId: 1,
      message: {
        kind: "user",
        uid: "qq-654321",
        name: "Alice",
        contents: [{ type: "text", text: "How are you?" }],
      },
      createdAt: Date.now(),
    });

    const messages = await db.listConversationMessages({
      conversationId: 1,
    });
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual(msg1);
    expect(messages).toContainEqual(msg2);
  });

  test("should list messages filtered by actor-scoped msgIds", async () => {
    const msg1 = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    });
    const msg2 = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "actor",
        name: "EMA",
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
    });
    await db.addConversationMessage({
      conversationId: 2,
      actorId: 2,
      message: {
        kind: "user",
        uid: "user-2",
        name: "bob",
        contents: [{ type: "text", text: "Another actor" }],
      },
      createdAt: Date.now(),
    });

    const messages = await db.listConversationMessages({
      actorId: 1,
      msgIds: [msg2.msgId, msg1.msgId],
      sort: "asc",
    });
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual(msg1);
    expect(messages).toContainEqual(msg2);
  });

  test("should handle CRUD operations in sequence", async () => {
    const stored = await db.addConversationMessage({
      conversationId: 1,
      actorId: 1,
      message: {
        kind: "user",
        uid: "user-1",
        name: "alice",
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    });

    let message = await db.getConversationMessage(stored.id);
    expect(message).toEqual(stored);

    const deleted = await db.deleteConversationMessage(stored.id);
    expect(deleted).toBe(true);
    message = await db.getConversationMessage(stored.id);
    expect(message).toBeNull();
  });
});
