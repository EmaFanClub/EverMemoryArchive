import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoConversationMessageDB } from "../../db";
import type { Mongo, ConversationMessageEntity } from "../../db";

describe("MongoConversationMessageDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoConversationMessageDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoConversationMessageDB(mongo);
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should list empty messages initially", async () => {
    const messages = await db.listConversationMessages({});
    expect(messages).toEqual([]);
  });

  test("should add a conversation message", async () => {
    const messageData: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };

    await db.addConversationMessage(messageData);
    const retrievedMessage = await db.getConversationMessage(1);
    expect(retrievedMessage).toEqual(messageData);
  });

  test("should delete a conversation message", async () => {
    const messageData: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };

    await db.addConversationMessage(messageData);
    const deleted = await db.deleteConversationMessage(1);
    expect(deleted).toBe(true);

    const retrievedMessage = await db.getConversationMessage(1);
    expect(retrievedMessage).toBeNull();
  });

  test("should return false when deleting non-existent message", async () => {
    const deleted = await db.deleteConversationMessage(999);
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted message", async () => {
    const messageData: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };

    await db.addConversationMessage(messageData);
    const deleted1 = await db.deleteConversationMessage(1);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteConversationMessage(1);
    expect(deleted2).toBe(false);
  });

  test("should not list deleted messages", async () => {
    const msg1: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };
    const msg2: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "actor",
        actorId: 1,
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
    };
    const msg3: ConversationMessageEntity = {
      conversationId: 2,
      message: {
        kind: "user",
        userId: 2,
        contents: [{ type: "text", text: "How are you?" }],
      },
      createdAt: Date.now(),
    };

    await db.addConversationMessage(msg1);
    await db.addConversationMessage(msg2);
    await db.addConversationMessage(msg3);

    // Delete msg2
    await db.deleteConversationMessage(2);

    const messages = await db.listConversationMessages({});
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual(msg1);
    expect(messages).toContainEqual(msg3);
    expect(messages).not.toContainEqual(expect.objectContaining({ id: 2 }));
  });

  test("should return null when getting non-existent message", async () => {
    const message = await db.getConversationMessage(999);
    expect(message).toBeNull();
  });

  test("should list messages filtered by conversationId", async () => {
    const msg1: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };
    const msg2: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "actor",
        actorId: 1,
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
    };
    const msg3: ConversationMessageEntity = {
      conversationId: 2,
      message: {
        kind: "user",
        userId: 2,
        contents: [{ type: "text", text: "How are you?" }],
      },
      createdAt: Date.now(),
    };

    await db.addConversationMessage(msg1);
    await db.addConversationMessage(msg2);
    await db.addConversationMessage(msg3);

    const messages = await db.listConversationMessages({
      conversationId: 1,
    });
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual(msg1);
    expect(messages).toContainEqual(msg2);
  });

  test("should handle messages from different senders", async () => {
    const msg1: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };
    const msg2: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "actor",
        actorId: 1,
        contents: [{ type: "text", text: "Hi there!" }],
      },
      createdAt: Date.now(),
    };
    const msg3: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 2,
        contents: [{ type: "text", text: "Let me help you" }],
      },
      createdAt: Date.now(),
    };

    await db.addConversationMessage(msg1);
    await db.addConversationMessage(msg2);
    await db.addConversationMessage(msg3);

    const messages = await db.listConversationMessages({
      conversationId: 1,
    });
    expect(messages).toHaveLength(3);
    expect(messages).toContainEqual(msg1);
    expect(messages).toContainEqual(msg2);
    expect(messages).toContainEqual(msg3);
  });

  test("should handle CRD operations in sequence", async () => {
    // Create (Add)
    const messageData: ConversationMessageEntity = {
      conversationId: 1,
      message: {
        kind: "user",
        userId: 1,
        contents: [{ type: "text", text: "Hello" }],
      },
      createdAt: Date.now(),
    };
    await db.addConversationMessage(messageData);

    // Read
    let message = await db.getConversationMessage(1);
    expect(message).toEqual(messageData);

    // Delete
    const deleted = await db.deleteConversationMessage(1);
    expect(deleted).toBe(true);
    message = await db.getConversationMessage(1);
    expect(message).toBeNull();
  });
});
