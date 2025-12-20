import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoActorDB } from "../../db";
import type { Mongo, ActorEntity } from "../../db";

describe("MongoActorDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoActorDB;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoActorDB(mongo);
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should list empty actors initially", async () => {
    const actors = await db.listActors();
    expect(actors).toEqual([]);
  });

  test("should create an actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };

    await db.upsertActor(actorData);
    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toEqual(actorData);
  });

  test("should update an existing actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };

    const id = await db.upsertActor(actorData);
    expect(id).toBe(1);

    const updatedActor: ActorEntity = {
      id,
      ...actorData,
      memoryBuffer: [{ role: "user", content: "Hello" }],
      updatedAt: Date.now(),
    };

    await db.upsertActor(updatedActor);
    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toEqual(updatedActor);
  });

  test("should delete an actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };

    await db.upsertActor(actorData);
    const deleted = await db.deleteActor(1);
    expect(deleted).toBe(true);

    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toBeNull();
  });

  test("should return false when deleting non-existent actor", async () => {
    const deleted = await db.deleteActor(999);
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };

    await db.upsertActor(actorData);
    const deleted1 = await db.deleteActor(1);
    expect(deleted1).toBe(true);

    // Try to delete again
    const deleted2 = await db.deleteActor(1);
    expect(deleted2).toBe(false);
  });

  test("should not list deleted actors", async () => {
    const actor1: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };
    const actor2: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };
    const actor3: ActorEntity = {
      roleId: 2,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };

    await db.upsertActor(actor1);
    await db.upsertActor(actor2);
    await db.upsertActor(actor3);

    // Delete actor2
    await db.deleteActor(2);

    const actors = await db.listActors();
    expect(actors).toHaveLength(2);
    expect(actors).toContainEqual(actor1);
    expect(actors).toContainEqual(actor3);
    expect(actors).not.toContainEqual(expect.objectContaining({ id: 2 }));
  });

  test("should return null when getting non-existent actor", async () => {
    const actor = await db.getActor(999);
    expect(actor).toBeNull();
  });

  test("should list multiple actors", async () => {
    const actor1: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };
    const actor2: ActorEntity = {
      roleId: 1,
      memoryBuffer: [{ role: "user", content: "Hello" }],
      updatedAt: Date.now(),
    };
    const actor3: ActorEntity = {
      roleId: 2,
      memoryBuffer: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
      updatedAt: Date.now(),
    };

    await db.upsertActor(actor1);
    await db.upsertActor(actor2);
    await db.upsertActor(actor3);

    const actors = await db.listActors();
    expect(actors).toHaveLength(3);
    expect(actors).toContainEqual(actor1);
    expect(actors).toContainEqual(actor2);
    expect(actors).toContainEqual(actor3);
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const actorData: ActorEntity = {
      roleId: 1,
      memoryBuffer: [],
      updatedAt: Date.now(),
    };
    await db.upsertActor(actorData);

    // Read
    let actor = await db.getActor(1);
    expect(actor).toEqual(actorData);

    // Update
    const updatedActor: ActorEntity = {
      ...actorData,
      memoryBuffer: [{ role: "user", content: "Hello" }],
      updatedAt: Date.now(),
    };
    await db.upsertActor(updatedActor);
    actor = await db.getActor(1);
    expect(actor).toEqual(updatedActor);

    // Delete
    const deleted = await db.deleteActor(1);
    expect(deleted).toBe(true);
    actor = await db.getActor(1);
    expect(actor).toBeNull();
  });
});
