import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoLongTermMemoryDB } from "../../db";
import type { Mongo, LongTermMemoryEntity } from "../../db";

describe("MongoLongTermMemoryDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoLongTermMemoryDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoLongTermMemoryDB(mongo);
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should list empty memories initially", async () => {
    const memories = await db.listLongTermMemories({});
    expect(memories).toEqual([]);
  });

  test("should append a long term memory", async () => {
    const memoryData: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1", "keyword2"],
      os: "Test OS",
      statement: "Test statement",
      createdAt: Date.now(),
      messages: ["msg-1", "msg-2"],
    };

    await db.appendLongTermMemory(memoryData);
    const memories = await db.listLongTermMemories({});
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(memoryData);
  });

  test("should delete a long term memory", async () => {
    const memoryData: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1", "keyword2"],
      os: "Test OS",
      statement: "Test statement",
      createdAt: Date.now(),
      messages: ["msg-1", "msg-2"],
    };

    await db.appendLongTermMemory(memoryData);
    const deleted = await db.deleteLongTermMemory(memoryData.id);
    expect(deleted).toBe(true);

    const memories = await db.listLongTermMemories({});
    expect(memories).toEqual([]);
  });

  test("should return false when deleting non-existent memory", async () => {
    const deleted = await db.deleteLongTermMemory("non-existent");
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted memory", async () => {
    const memoryData: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1", "keyword2"],
      os: "Test OS",
      statement: "Test statement",
      createdAt: Date.now(),
      messages: ["msg-1", "msg-2"],
    };

    await db.appendLongTermMemory(memoryData);
    const deleted1 = await db.deleteLongTermMemory(memoryData.id);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteLongTermMemory(memoryData.id);
    expect(deleted2).toBe(false);
  });

  test("should list memories filtered by actorId", async () => {
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1"],
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: Date.now(),
      messages: ["msg-1"],
    };
    const mem2: LongTermMemoryEntity = {
      id: "mem-2",
      actorId: "actor-1",
      index0: "category2",
      index1: "subcategory2",
      keywords: ["keyword2"],
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: Date.now(),
      messages: ["msg-2"],
    };
    const mem3: LongTermMemoryEntity = {
      id: "mem-3",
      actorId: "actor-2",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword3"],
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: Date.now(),
      messages: ["msg-3"],
    };

    await db.appendLongTermMemory(mem1);
    await db.appendLongTermMemory(mem2);
    await db.appendLongTermMemory(mem3);

    const memories = await db.listLongTermMemories({ actorId: "actor-1" });
    expect(memories).toHaveLength(2);
    expect(memories).toContainEqual(mem1);
    expect(memories).toContainEqual(mem2);
  });

  test("should list memories filtered by createdBefore", async () => {
    const now = Date.now();
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1"],
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now - 1000,
      messages: ["msg-1"],
    };
    const mem2: LongTermMemoryEntity = {
      id: "mem-2",
      actorId: "actor-1",
      index0: "category2",
      index1: "subcategory2",
      keywords: ["keyword2"],
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: ["msg-2"],
    };
    const mem3: LongTermMemoryEntity = {
      id: "mem-3",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword3"],
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 1000,
      messages: ["msg-3"],
    };

    await db.appendLongTermMemory(mem1);
    await db.appendLongTermMemory(mem2);
    await db.appendLongTermMemory(mem3);

    const memories = await db.listLongTermMemories({ createdBefore: now });
    expect(memories).toHaveLength(2);
    expect(memories).toContainEqual(mem1);
    expect(memories).toContainEqual(mem2);
  });

  test("should list memories filtered by createdAfter", async () => {
    const now = Date.now();
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1"],
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now - 1000,
      messages: ["msg-1"],
    };
    const mem2: LongTermMemoryEntity = {
      id: "mem-2",
      actorId: "actor-1",
      index0: "category2",
      index1: "subcategory2",
      keywords: ["keyword2"],
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: ["msg-2"],
    };
    const mem3: LongTermMemoryEntity = {
      id: "mem-3",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword3"],
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 1000,
      messages: ["msg-3"],
    };

    await db.appendLongTermMemory(mem1);
    await db.appendLongTermMemory(mem2);
    await db.appendLongTermMemory(mem3);

    const memories = await db.listLongTermMemories({ createdAfter: now });
    expect(memories).toHaveLength(2);
    expect(memories).toContainEqual(mem2);
    expect(memories).toContainEqual(mem3);
  });

  test("should list memories filtered by createdBefore and createdAfter", async () => {
    const now = Date.now();
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1"],
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now - 2000,
      messages: ["msg-1"],
    };
    const mem2: LongTermMemoryEntity = {
      id: "mem-2",
      actorId: "actor-1",
      index0: "category2",
      index1: "subcategory2",
      keywords: ["keyword2"],
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: ["msg-2"],
    };
    const mem3: LongTermMemoryEntity = {
      id: "mem-3",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword3"],
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 2000,
      messages: ["msg-3"],
    };

    await db.appendLongTermMemory(mem1);
    await db.appendLongTermMemory(mem2);
    await db.appendLongTermMemory(mem3);

    const memories = await db.listLongTermMemories({
      createdAfter: now - 1000,
      createdBefore: now + 1000,
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(mem2);
  });

  test("should list memories filtered by actorId and time range", async () => {
    const now = Date.now();
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1"],
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now,
      messages: ["msg-1"],
    };
    const mem2: LongTermMemoryEntity = {
      id: "mem-2",
      actorId: "actor-2",
      index0: "category2",
      index1: "subcategory2",
      keywords: ["keyword2"],
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: ["msg-2"],
    };
    const mem3: LongTermMemoryEntity = {
      id: "mem-3",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword3"],
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 2000,
      messages: ["msg-3"],
    };

    await db.appendLongTermMemory(mem1);
    await db.appendLongTermMemory(mem2);
    await db.appendLongTermMemory(mem3);

    const memories = await db.listLongTermMemories({
      actorId: "actor-1",
      createdBefore: now + 1000,
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(mem1);
  });

  test("should handle memories with multiple keywords", async () => {
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "category1",
      index1: "subcategory1",
      keywords: ["keyword1", "keyword2", "keyword3"],
      os: "Test OS",
      statement: "Memory with multiple keywords",
      createdAt: Date.now(),
      messages: ["msg-1"],
    };

    await db.appendLongTermMemory(mem1);
    const memories = await db.listLongTermMemories({ actorId: "actor-1" });
    expect(memories).toHaveLength(1);
    expect(memories[0].keywords).toHaveLength(3);
    expect(memories[0].keywords).toContain("keyword1");
    expect(memories[0].keywords).toContain("keyword2");
    expect(memories[0].keywords).toContain("keyword3");
  });

  test("should handle memories with different index hierarchies", async () => {
    const mem1: LongTermMemoryEntity = {
      id: "mem-1",
      actorId: "actor-1",
      index0: "work",
      index1: "meetings",
      keywords: ["meeting"],
      os: "Test OS",
      statement: "Work meeting memory",
      createdAt: Date.now(),
      messages: ["msg-1"],
    };
    const mem2: LongTermMemoryEntity = {
      id: "mem-2",
      actorId: "actor-1",
      index0: "personal",
      index1: "family",
      keywords: ["family"],
      os: "Test OS",
      statement: "Family memory",
      createdAt: Date.now(),
      messages: ["msg-2"],
    };

    await db.appendLongTermMemory(mem1);
    await db.appendLongTermMemory(mem2);

    const memories = await db.listLongTermMemories({ actorId: "actor-1" });
    expect(memories).toHaveLength(2);
    expect(memories.find((m) => m.index0 === "work")).toBeDefined();
    expect(memories.find((m) => m.index0 === "personal")).toBeDefined();
  });
});
