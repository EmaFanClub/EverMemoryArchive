import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoPersonalityDB } from "../../db";
import type { Mongo, PersonalityEntity } from "../../db";

describe("MongoPersonalityDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoPersonalityDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoPersonalityDB(mongo);
  });

  afterEach(async () => {
    await mongo.close();
  });

  test("should list empty personalities initially", async () => {
    const items = await db.listPersonalities();
    expect(items).toEqual([]);
  });

  test("should create a personality", async () => {
    const personality: PersonalityEntity = {
      actorId: 1,
      memory: "# personality",
    };
    const id = await db.upsertPersonality(personality);
    expect(id).toBe(1);

    const retrieved = await db.getPersonality(1);
    expect(retrieved).toEqual(personality);
  });

  test("should update personality by actorId", async () => {
    const id1 = await db.upsertPersonality({
      actorId: 1,
      memory: "# personality v1",
    });
    const id2 = await db.upsertPersonality({
      actorId: 1,
      memory: "# personality v2",
    });
    expect(id2).toBe(id1);

    const retrieved = await db.getPersonality(1);
    expect(retrieved).toMatchObject({
      actorId: 1,
      memory: "# personality v2",
    });
    const items = await db.listPersonalities();
    expect(items).toHaveLength(1);
  });

  test("should delete personality by actorId", async () => {
    await db.upsertPersonality({
      actorId: 1,
      memory: "# personality",
    });
    const deleted = await db.deletePersonality(1);
    expect(deleted).toBe(true);
    expect(await db.getPersonality(1)).toBeNull();
  });

  test("should return false when deleting non-existent personality", async () => {
    const deleted = await db.deletePersonality(123);
    expect(deleted).toBe(false);
  });

  test("should list multiple personalities", async () => {
    const p1: PersonalityEntity = { actorId: 1, memory: "# p1" };
    const p2: PersonalityEntity = { actorId: 2, memory: "# p2" };
    await db.upsertPersonality(p1);
    await db.upsertPersonality(p2);
    const items = await db.listPersonalities();
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(p1);
    expect(items).toContainEqual(p2);
  });
});
