import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoShortTermMemoryDB } from "../../db";
import type { Mongo, ShortTermMemoryEntity } from "../../db";

describe("MongoShortTermMemoryDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoShortTermMemoryDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoShortTermMemoryDB(mongo);
  }, 60000);

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should list empty memories initially", async () => {
    const memories = await db.listShortTermMemories({});
    expect(memories).toEqual([]);
  });

  test("should append a short term memory", async () => {
    const memoryData: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS",
      statement: "Test statement",
      createdAt: Date.now(),
      messages: [1, 2],
    };

    await db.appendShortTermMemory(memoryData);
    const memories = await db.listShortTermMemories({});
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(memoryData);
  });

  test("should delete a short term memory", async () => {
    const memoryData: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS",
      statement: "Test statement",
      createdAt: Date.now(),
      messages: [1, 2],
    };

    await db.appendShortTermMemory(memoryData);
    const deleted = await db.deleteShortTermMemory(1);
    expect(deleted).toBe(true);

    const memories = await db.listShortTermMemories({});
    expect(memories).toEqual([]);
  });

  test("should return false when deleting non-existent memory", async () => {
    const deleted = await db.deleteShortTermMemory(999);
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted memory", async () => {
    const memoryData: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS",
      statement: "Test statement",
      createdAt: Date.now(),
      messages: [1, 2],
    };

    await db.appendShortTermMemory(memoryData);
    const deleted1 = await db.deleteShortTermMemory(1);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteShortTermMemory(1);
    expect(deleted2).toBe(false);
  });

  test("should list memories filtered by actorId", async () => {
    const mem1: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: Date.now(),
      messages: [1],
    };
    const mem2: ShortTermMemoryEntity = {
      kind: "month",
      actorId: 1,
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: Date.now(),
      messages: [2],
    };
    const mem3: ShortTermMemoryEntity = {
      kind: "year",
      actorId: 2,
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: Date.now(),
      messages: [3],
    };

    await db.appendShortTermMemory(mem1);
    await db.appendShortTermMemory(mem2);
    await db.appendShortTermMemory(mem3);

    const memories = await db.listShortTermMemories({ actorId: 1 });
    expect(memories).toHaveLength(2);
    expect(memories).toContainEqual(mem1);
    expect(memories).toContainEqual(mem2);
  });

  test("should list memories filtered by createdBefore", async () => {
    const now = Date.now();
    const mem1: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now - 1000,
      messages: [1],
    };
    const mem2: ShortTermMemoryEntity = {
      kind: "month",
      actorId: 1,
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: [2],
    };
    const mem3: ShortTermMemoryEntity = {
      kind: "year",
      actorId: 1,
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 1000,
      messages: [3],
    };

    await db.appendShortTermMemory(mem1);
    await db.appendShortTermMemory(mem2);
    await db.appendShortTermMemory(mem3);

    const memories = await db.listShortTermMemories({ createdBefore: now });
    expect(memories).toHaveLength(2);
    expect(memories).toContainEqual(mem1);
    expect(memories).toContainEqual(mem2);
  });

  test("should list memories filtered by createdAfter", async () => {
    const now = Date.now();
    const mem1: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now - 1000,
      messages: [1],
    };
    const mem2: ShortTermMemoryEntity = {
      kind: "month",
      actorId: 1,
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: [2],
    };
    const mem3: ShortTermMemoryEntity = {
      kind: "year",
      actorId: 1,
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 1000,
      messages: [3],
    };

    await db.appendShortTermMemory(mem1);
    await db.appendShortTermMemory(mem2);
    await db.appendShortTermMemory(mem3);

    const memories = await db.listShortTermMemories({ createdAfter: now });
    expect(memories).toHaveLength(2);
    expect(memories).toContainEqual(mem2);
    expect(memories).toContainEqual(mem3);
  });

  test("should list memories filtered by createdBefore and createdAfter", async () => {
    const now = Date.now();
    const mem1: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now - 2000,
      messages: [1],
    };
    const mem2: ShortTermMemoryEntity = {
      kind: "month",
      actorId: 1,
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: [2],
    };
    const mem3: ShortTermMemoryEntity = {
      kind: "year",
      actorId: 1,
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 2000,
      messages: [3],
    };

    await db.appendShortTermMemory(mem1);
    await db.appendShortTermMemory(mem2);
    await db.appendShortTermMemory(mem3);

    const memories = await db.listShortTermMemories({
      createdAfter: now - 1000,
      createdBefore: now + 1000,
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(mem2);
  });

  test("should list memories filtered by actorId and time range", async () => {
    const now = Date.now();
    const mem1: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS 1",
      statement: "Test statement 1",
      createdAt: now,
      messages: [1],
    };
    const mem2: ShortTermMemoryEntity = {
      kind: "month",
      actorId: 2,
      os: "Test OS 2",
      statement: "Test statement 2",
      createdAt: now,
      messages: [2],
    };
    const mem3: ShortTermMemoryEntity = {
      kind: "year",
      actorId: 1,
      os: "Test OS 3",
      statement: "Test statement 3",
      createdAt: now + 2000,
      messages: [3],
    };

    await db.appendShortTermMemory(mem1);
    await db.appendShortTermMemory(mem2);
    await db.appendShortTermMemory(mem3);

    const memories = await db.listShortTermMemories({
      actorId: 1,
      createdBefore: now + 1000,
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(mem1);
  });

  test("should handle different memory kinds", async () => {
    const mem1: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      os: "Test OS",
      statement: "Daily memory",
      createdAt: Date.now(),
      messages: [1],
    };
    const mem2: ShortTermMemoryEntity = {
      kind: "month",
      actorId: 1,
      os: "Test OS",
      statement: "Monthly memory",
      createdAt: Date.now(),
      messages: [2],
    };
    const mem3: ShortTermMemoryEntity = {
      kind: "year",
      actorId: 1,
      os: "Test OS",
      statement: "Yearly memory",
      createdAt: Date.now(),
      messages: [3],
    };

    await db.appendShortTermMemory(mem1);
    await db.appendShortTermMemory(mem2);
    await db.appendShortTermMemory(mem3);

    const memories = await db.listShortTermMemories({ actorId: 1 });
    expect(memories).toHaveLength(3);
    expect(memories.find((m) => m.kind === "day")).toBeDefined();
    expect(memories.find((m) => m.kind === "month")).toBeDefined();
    expect(memories.find((m) => m.kind === "year")).toBeDefined();
  });
});
