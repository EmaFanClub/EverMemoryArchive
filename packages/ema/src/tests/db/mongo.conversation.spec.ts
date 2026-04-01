import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoConversationDB } from "../../db";
import type { Mongo, ConversationEntity } from "../../db";

const WEB_CHAT_1 = "web-chat-1";
const WEB_CHAT_2 = "web-chat-2";
const QQ_GROUP_123456 = "qq-group-123456";

describe("MongoConversationDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoConversationDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoConversationDB(mongo);
  });

  afterEach(async () => {
    await mongo.close();
  });

  test("should list empty conversations initially", async () => {
    const conversations = await db.listConversations({});
    expect(conversations).toEqual([]);
  });

  test("should create a conversation", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
      allowProactive: true,
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
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const id = await db.upsertConversation(conversationData);
    expect(id).toBe(1);

    const updatedConversation: ConversationEntity = {
      ...conversationData,
      id,
      name: "Updated Conversation",
      description: "Updated description.",
      updatedAt: Date.now(),
    };

    await db.upsertConversation(updatedConversation);
    const retrievedConversation = await db.getConversation(1);
    expect(retrievedConversation).toEqual(updatedConversation);
  });

  test("should delete a conversation", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
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

  test("should list conversations filtered by actorId", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      description: "Current messages come from QQ group 123456.",
      actorId: 1,
      session: QQ_GROUP_123456,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      name: "Conversation 3",
      description: "None.",
      actorId: 2,
      session: WEB_CHAT_2,
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

  test("should list conversations filtered by session", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      description: "Current messages come from QQ group 123456.",
      actorId: 1,
      session: QQ_GROUP_123456,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv3: ConversationEntity = {
      name: "Conversation 3",
      description: "None.",
      actorId: 2,
      session: WEB_CHAT_1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);
    await db.upsertConversation(conv3);

    const conversations = await db.listConversations({
      session: WEB_CHAT_1,
    });
    expect(conversations).toHaveLength(2);
    expect(conversations).toContainEqual(conv1);
    expect(conversations).toContainEqual(conv3);
  });

  test("should get conversation by actor and session", async () => {
    const conv1: ConversationEntity = {
      name: "Conversation 1",
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conv2: ConversationEntity = {
      name: "Conversation 2",
      description: "Current messages come from QQ group 123456.",
      actorId: 1,
      session: QQ_GROUP_123456,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.upsertConversation(conv1);
    await db.upsertConversation(conv2);

    const conversation = await db.getConversationByActorAndSession(
      1,
      QQ_GROUP_123456,
    );
    expect(conversation).toEqual(conv2);
  });

  test("should handle CRUD operations in sequence", async () => {
    const conversationData: ConversationEntity = {
      name: "Test Conversation",
      description: "None.",
      actorId: 1,
      session: WEB_CHAT_1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.upsertConversation(conversationData);

    let conversation = await db.getConversation(1);
    expect(conversation).toEqual(conversationData);

    const deleted = await db.deleteConversation(1);
    expect(deleted).toBe(true);
    conversation = await db.getConversation(1);
    expect(conversation).toBeNull();
  });
});
