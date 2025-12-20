import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoConversationDB } from "../../db";
import type { Mongo, ConversationEntity } from "../../db";

describe("MongoConversationDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoConversationDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoConversationDB(mongo);
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should list empty conversations initially", async () => {
    const conversations = await db.listConversations({});
    expect(conversations).toEqual([]);
  });

  test("should create a conversation", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);
    const retrievedConversation = await db.getConversation(1);
    expect(retrievedConversation).toEqual(conversationData);
  });

  test("should update an existing conversation", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const id = await db.upsertConversation(conversationData);
    expect(id).toBe(1);

    const updatedConversation: ConversationEntity = {
      id,
      ...conversationData,
      name: "Updated Conversation",
      updatedAt: Date.now(),
    };

    await db.upsertConversation(updatedConversation);
    const retrievedConversation = await db.getConversation(1);
    expect(retrievedConversation).toEqual(updatedConversation);
  });

  test("should delete a conversation", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);
    const deleted = await db.deleteConversation(1);
    expect(deleted).toBe(true);

    const retrievedConversation = await db.getConversation(1);
    expect(retrievedConversation).toBeNull();
  });

  test("should return false when deleting non-existent conversation", async () => {
    const deleted = await db.deleteConversation(999);
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted conversation", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);
    const deleted1 = await db.deleteConversation(1);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteConversation(1);
    expect(deleted2).toBe(false);
  });

  test("should not list deleted conversations", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      name: "Conversation 3",
      actorId: 2,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    // Delete conv2
    await db.deleteConversation(2);

    const conversations = await db.listConversations({});
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv3);
    expect(conversations).not.toContainEqual(
      expect.objectContaining({ id: 2 }),
    );
  });

  test("should return null when getting non-existent conversation", async () => {
    const conversation = await db.getConversation(999);
    expect(conversation).toBeNull();
  });

  test("should list conversations filtered by actorId", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      actorId: 1,
      userId: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      name: "Conversation 3",
      actorId: 2,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({ actorId: 1 });
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv2);
  });

  test("should list conversations filtered by userId", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      actorId: 1,
      userId: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      name: "Conversation 3",
      actorId: 2,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({ userId: 1 });
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv3);
  });

  test("should list conversations filtered by both actorId and userId", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      actorId: 1,
      userId: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      name: "Conversation 3",
      actorId: 2,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({
      actorId: 1,
      userId: 1,
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toEqual(conv1);
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      actorId: 1,
      userId: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.upsertConversation(conversationData);

    // Read
    let conversation = await db.getConversation(1);
    expect(conversation).toEqual(conversationData);

    // Update
    const updatedConversation: ConversationEntity = {
      ...conversationData,
      name: "Updated Conversation",
      updatedAt: Date.now(),
    };
    await db.upsertConversation(updatedConversation);
    conversation = await db.getConversation(1);
    expect(conversation).toEqual(updatedConversation);

    // Delete
    const deleted = await db.deleteConversation(1);
    expect(deleted).toBe(true);
    conversation = await db.getConversation(1);
    expect(conversation).toBeNull();
  });
});
