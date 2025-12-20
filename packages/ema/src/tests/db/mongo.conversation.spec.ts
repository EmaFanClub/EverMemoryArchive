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
      id: "conv-1",
      name: "Test Conversation",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);
    const retrievedConversation = await db.getConversation(conversationData.id);
    expect(retrievedConversation).toEqual(conversationData);
  });

  test("should update an existing conversation", async () => {
    const conversationData: ConversationEntity = {
      id: "conv-1",
      name: "Test Conversation",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);

    const updatedConversation: ConversationEntity = {
      ...conversationData,
      name: "Updated Conversation",
      updatedAt: Date.now(),
    };

    await db.upsertConversation(updatedConversation);
    const retrievedConversation = await db.getConversation(conversationData.id);
    expect(retrievedConversation).toEqual(updatedConversation);
  });

  test("should delete a conversation", async () => {
    const conversationData: ConversationEntity = {
      id: "conv-1",
      name: "Test Conversation",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);
    const deleted = await db.deleteConversation(conversationData.id);
    expect(deleted).toBe(true);

    const retrievedConversation = await db.getConversation(conversationData.id);
    expect(retrievedConversation).toBeNull();
  });

  test("should return false when deleting non-existent conversation", async () => {
    const deleted = await db.deleteConversation("non-existent");
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted conversation", async () => {
    const conversationData: ConversationEntity = {
      id: "conv-1",
      name: "Test Conversation",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conversationData);
    const deleted1 = await db.deleteConversation(conversationData.id);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteConversation(conversationData.id);
    expect(deleted2).toBe(false);
  });

  test("should not list deleted conversations", async () => {
    const conv1: ConversationEntity = {
      id: "conv-1",
      name: "Conversation 1",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      id: "conv-2",
      name: "Conversation 2",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      id: "conv-3",
      name: "Conversation 3",
      actorId: "actor-2",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    // Delete conv2
    await db.deleteConversation(conv2.id);

    const conversations = await db.listConversations({});
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv3);
    expect(conversations).not.toContainEqual(
      expect.objectContaining({ id: conv2.id }),
    );
  });

  test("should return null when getting non-existent conversation", async () => {
    const conversation = await db.getConversation("non-existent");
    expect(conversation).toBeNull();
  });

  test("should list conversations filtered by actorId", async () => {
    const conv1: ConversationEntity = {
      id: "conv-1",
      name: "Conversation 1",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      id: "conv-2",
      name: "Conversation 2",
      actorId: "actor-1",
      userId: "user-2",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      id: "conv-3",
      name: "Conversation 3",
      actorId: "actor-2",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({ actorId: "actor-1" });
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv2);
  });

  test("should list conversations filtered by userId", async () => {
    const conv1: ConversationEntity = {
      id: "conv-1",
      name: "Conversation 1",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      id: "conv-2",
      name: "Conversation 2",
      actorId: "actor-1",
      userId: "user-2",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      id: "conv-3",
      name: "Conversation 3",
      actorId: "actor-2",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({ userId: "user-1" });
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv3);
  });

  test("should list conversations filtered by both actorId and userId", async () => {
    const conv1: ConversationEntity = {
      id: "conv-1",
      name: "Conversation 1",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      id: "conv-2",
      name: "Conversation 2",
      actorId: "actor-1",
      userId: "user-2",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      id: "conv-3",
      name: "Conversation 3",
      actorId: "actor-2",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({
      actorId: "actor-1",
      userId: "user-1",
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toEqual(conv1);
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const conversationData: ConversationEntity = {
      id: "conv-1",
      name: "Test Conversation",
      actorId: "actor-1",
      userId: "user-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.upsertConversation(conversationData);

    // Read
    let conversation = await db.getConversation(conversationData.id);
    expect(conversation).toEqual(conversationData);

    // Update
    const updatedConversation: ConversationEntity = {
      ...conversationData,
      name: "Updated Conversation",
      updatedAt: Date.now(),
    };
    await db.upsertConversation(updatedConversation);
    conversation = await db.getConversation(conversationData.id);
    expect(conversation).toEqual(updatedConversation);

    // Delete
    const deleted = await db.deleteConversation(conversationData.id);
    expect(deleted).toBe(true);
    conversation = await db.getConversation(conversationData.id);
    expect(conversation).toBeNull();
  });
});
