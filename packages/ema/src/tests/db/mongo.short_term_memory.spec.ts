import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoShortTermMemoryDB } from "../../db";
import type { Mongo, ShortTermMemoryEntity } from "../../db";

describe("MongoShortTermMemoryDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoShortTermMemoryDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoShortTermMemoryDB(mongo);
  }, 60000);

  afterEach(async () => {
    await mongo.close();
  });

  test("should list empty memories initially", async () => {
    const memories = await db.listShortTermMemories({});
    expect(memories).toEqual([]);
  });

  test("should append and read a short-term memory", async () => {
    const memoryData: ShortTermMemoryEntity = {
      kind: "day",
      actorId: 1,
      date: "2026-04-01",
      memory: "Test statement",
      createdAt: Date.now(),
    };

    await db.appendShortTermMemory(memoryData);
    const memories = await db.listShortTermMemories({});
    expect(memories).toHaveLength(1);
    expect(memories[0]).toEqual(memoryData);
  });

  test("should upsert a short-term memory by id", async () => {
    const createdAt = Date.now();
    await db.appendShortTermMemory({
      kind: "day",
      actorId: 1,
      date: "2026-04-01",
      memory: "Before",
      createdAt,
    });

    const id = await db.upsertShortTermMemory({
      id: 1,
      kind: "day",
      actorId: 1,
      date: "2026-04-01",
      memory: "After",
      createdAt,
      updatedAt: createdAt + 1000,
    });
    expect(id).toBe(1);

    const memories = await db.listShortTermMemories({ actorId: 1 });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      id: 1,
      kind: "day",
      actorId: 1,
      date: "2026-04-01",
      memory: "After",
      createdAt,
      updatedAt: createdAt + 1000,
    });
  });

  test("should filter memories by processed state", async () => {
    await db.appendShortTermMemory({
      kind: "activity",
      actorId: 1,
      date: "2026-04-01",
      memory: "a",
    });
    await db.appendShortTermMemory({
      kind: "activity",
      actorId: 1,
      date: "2026-04-02",
      memory: "b",
      processedAt: Date.now(),
    });

    const unprocessed = await db.listShortTermMemories({ processed: false });
    const processed = await db.listShortTermMemories({ processed: true });

    expect(unprocessed.map((item) => item.date)).toEqual(["2026-04-01"]);
    expect(processed.map((item) => item.date)).toEqual(["2026-04-02"]);
  });

  test("should allow multiple activity records on the same date", async () => {
    await db.appendShortTermMemory({
      kind: "activity",
      actorId: 1,
      date: "2026-04-01",
      memory: "a",
    });
    await db.appendShortTermMemory({
      kind: "activity",
      actorId: 1,
      date: "2026-04-01",
      memory: "b",
    });

    const memories = await db.listShortTermMemories({
      actorId: 1,
      kind: "activity",
      sort: "asc",
    });
    expect(memories.map((item) => item.memory)).toEqual(["a", "b"]);
  });

  test("should filter activity memories by visible state", async () => {
    await db.appendShortTermMemory({
      kind: "activity",
      actorId: 1,
      date: "2026-04-01",
      memory: "visible",
      visible: true,
    });
    await db.appendShortTermMemory({
      kind: "activity",
      actorId: 1,
      date: "2026-04-02",
      memory: "hidden",
      visible: false,
    });

    const visible = await db.listShortTermMemories({ visible: true });
    const hidden = await db.listShortTermMemories({ visible: false });

    expect(visible.map((item) => item.memory)).toEqual(["visible"]);
    expect(hidden.map((item) => item.memory)).toEqual(["hidden"]);
  });

  test("should sort and limit by date", async () => {
    await db.appendShortTermMemory({
      kind: "day",
      actorId: 1,
      date: "2026-04-01",
      memory: "1",
    });
    await db.appendShortTermMemory({
      kind: "day",
      actorId: 1,
      date: "2026-04-03",
      memory: "3",
    });
    await db.appendShortTermMemory({
      kind: "day",
      actorId: 1,
      date: "2026-04-02",
      memory: "2",
    });

    const memories = await db.listShortTermMemories({
      actorId: 1,
      kind: "day",
      sort: "desc",
      limit: 2,
    });
    expect(memories.map((item) => item.date)).toEqual([
      "2026-04-03",
      "2026-04-02",
    ]);
  });

  test("should delete a short-term memory", async () => {
    await db.appendShortTermMemory({
      kind: "day",
      actorId: 1,
      date: "2026-04-01",
      memory: "Test statement",
      createdAt: Date.now(),
    });
    const deleted = await db.deleteShortTermMemory(1);
    expect(deleted).toBe(true);
    const memories = await db.listShortTermMemories({});
    expect(memories).toEqual([]);
  });
});
