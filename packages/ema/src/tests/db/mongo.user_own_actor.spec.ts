import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoUserOwnActorDB } from "../../db";
import type { Mongo, UserOwnActorRelation } from "../../db";

describe("MongoUserOwnActorDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoUserOwnActorDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoUserOwnActorDB(mongo);
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should list empty relations initially", async () => {
    const relations = await db.listUserOwnActorRelations({});
    expect(relations).toEqual([]);
  });

  test("should add an actor to a user", async () => {
    const relation: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };

    const added = await db.addActorToUser(relation);
    expect(added).toBe(true);

    const relations = await db.listUserOwnActorRelations({});
    expect(relations).toHaveLength(1);
    expect(relations[0]).toEqual(relation);
  });

  test("should return false when adding duplicate relation", async () => {
    const relation: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };

    const added1 = await db.addActorToUser(relation);
    expect(added1).toBe(true);

    // Try to add again
    const added2 = await db.addActorToUser(relation);
    expect(added2).toBe(false);
  });

  test("should remove an actor from a user", async () => {
    const relation: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };

    await db.addActorToUser(relation);
    const removed = await db.removeActorFromUser(relation);
    expect(removed).toBe(true);

    const relations = await db.listUserOwnActorRelations({});
    expect(relations).toEqual([]);
  });

  test("should return false when removing non-existent relation", async () => {
    const relation: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };

    const removed = await db.removeActorFromUser(relation);
    expect(removed).toBe(false);
  });

  test("should list relations filtered by userId", async () => {
    const relation1: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };
    const relation2: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-2",
    };
    const relation3: UserOwnActorRelation = {
      userId: "user-2",
      actorId: "actor-1",
    };

    await db.addActorToUser(relation1);
    await db.addActorToUser(relation2);
    await db.addActorToUser(relation3);

    const relations = await db.listUserOwnActorRelations({ userId: "user-1" });
    expect(relations).toHaveLength(2);
    expect(relations).toContainEqual(relation1);
    expect(relations).toContainEqual(relation2);
  });

  test("should list relations filtered by actorId", async () => {
    const relation1: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };
    const relation2: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-2",
    };
    const relation3: UserOwnActorRelation = {
      userId: "user-2",
      actorId: "actor-1",
    };

    await db.addActorToUser(relation1);
    await db.addActorToUser(relation2);
    await db.addActorToUser(relation3);

    const relations = await db.listUserOwnActorRelations({ actorId: "actor-1" });
    expect(relations).toHaveLength(2);
    expect(relations).toContainEqual(relation1);
    expect(relations).toContainEqual(relation3);
  });

  test("should list relations filtered by both userId and actorId", async () => {
    const relation1: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };
    const relation2: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-2",
    };
    const relation3: UserOwnActorRelation = {
      userId: "user-2",
      actorId: "actor-1",
    };

    await db.addActorToUser(relation1);
    await db.addActorToUser(relation2);
    await db.addActorToUser(relation3);

    const relations = await db.listUserOwnActorRelations({
      userId: "user-1",
      actorId: "actor-1",
    });
    expect(relations).toHaveLength(1);
    expect(relations[0]).toEqual(relation1);
  });

  test("should handle multiple relations for same user", async () => {
    const relation1: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-1",
    };
    const relation2: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-2",
    };
    const relation3: UserOwnActorRelation = {
      userId: "user-1",
      actorId: "actor-3",
    };

    await db.addActorToUser(relation1);
    await db.addActorToUser(relation2);
    await db.addActorToUser(relation3);

    const relations = await db.listUserOwnActorRelations({ userId: "user-1" });
    expect(relations).toHaveLength(3);
  });
});
