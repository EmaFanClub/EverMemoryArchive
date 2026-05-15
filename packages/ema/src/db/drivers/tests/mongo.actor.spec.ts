import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoActorDB } from "../..";
import type { Mongo, ActorEntity } from "../..";

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
      enabled: true,
      avatarUrl: "/avatars/1.png",
    };

    await db.upsertActor(actorData);
    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toEqual(
      expect.objectContaining({
        roleId: actorData.roleId,
        enabled: true,
        avatarUrl: "/avatars/1.png",
      }),
    );
    expect(typeof retrievedActor?.updatedAt).toBe("number");
  });

  test("should normalize legacy actors as enabled", async () => {
    const collection = mongo.getDb().collection("actors");
    await collection.insertOne({ id: 1, roleId: 1 });

    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toEqual(
      expect.objectContaining({
        id: 1,
        roleId: 1,
        enabled: true,
        origin: "blank",
      }),
    );
  });

  test("should preserve actor origin and training lifecycle fields", async () => {
    await db.upsertActor({
      roleId: 1,
      enabled: false,
      origin: "training",
      trainingStatus: "running",
      trainingUpdatedAt: 1_700_000_000_000,
    });

    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toEqual(
      expect.objectContaining({
        origin: "training",
        trainingStatus: "running",
        trainingUpdatedAt: 1_700_000_000_000,
      }),
    );
  });

  test("should update an existing actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      enabled: true,
    };

    const id = await db.upsertActor(actorData);
    expect(id).toBe(1);

    const updatedActor: ActorEntity = {
      id,
      roleId: 2,
      enabled: true,
    };

    await db.upsertActor(updatedActor);
    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toEqual(
      expect.objectContaining({ id, roleId: updatedActor.roleId }),
    );
    expect(typeof retrievedActor?.updatedAt).toBe("number");
  });

  test("should clear actor LLM config", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      enabled: true,
      llmConfig: {
        model: "gpt-5.5",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
      },
    };

    const id = await db.upsertActor(actorData);

    await expect(db.clearActorLlmConfig(id)).resolves.toBe(true);
    const retrievedActor = await db.getActor(id);
    expect(retrievedActor?.llmConfig).toBeUndefined();
  });

  test("should delete an actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      enabled: true,
    };

    await db.upsertActor(actorData);
    const deleted = await db.deleteActor(1);
    expect(deleted).toBe(true);

    const retrievedActor = await db.getActor(1);
    expect(retrievedActor).toBeNull();
    const deletedActor = await db.getActor(1, { includeDeleted: true });
    expect(deletedActor).toEqual(
      expect.objectContaining({
        id: 1,
        roleId: 1,
        enabled: false,
      }),
    );
    expect(typeof deletedActor?.deletedAt).toBe("number");
  });

  test("should use the provided deletedAt when deleting an actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      enabled: true,
    };
    const deletedAt = Date.now() - 1000;

    await db.upsertActor(actorData);
    const deleted = await db.deleteActor(1, deletedAt);

    expect(deleted).toBe(true);
    const deletedActor = await db.getActor(1, { includeDeleted: true });
    expect(deletedActor).toEqual(
      expect.objectContaining({
        deletedAt,
        updatedAt: deletedAt,
      }),
    );
  });

  test("should return false when deleting non-existent actor", async () => {
    const deleted = await db.deleteActor(999);
    expect(deleted).toBe(false);
  });

  test("should return false when deleting already deleted actor", async () => {
    const actorData: ActorEntity = {
      roleId: 1,
      enabled: true,
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
      enabled: true,
    };
    const actor2: ActorEntity = {
      roleId: 1,
      enabled: true,
    };
    const actor3: ActorEntity = {
      roleId: 2,
      enabled: true,
    };

    await db.upsertActor(actor1);
    await db.upsertActor(actor2);
    await db.upsertActor(actor3);

    // Delete actor2
    await db.deleteActor(2);

    const actors = await db.listActors();
    expect(actors).toHaveLength(2);
    expect(actors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: actor1.roleId }),
        expect.objectContaining({ roleId: actor3.roleId }),
      ]),
    );
    expect(actors).not.toContainEqual(expect.objectContaining({ id: 2 }));

    const allActors = await db.listActors({ includeDeleted: true });
    expect(allActors).toHaveLength(3);
    expect(allActors).toContainEqual(
      expect.objectContaining({ id: 2, deletedAt: expect.any(Number) }),
    );
  });

  test("should return null when getting non-existent actor", async () => {
    const actor = await db.getActor(999);
    expect(actor).toBeNull();
  });

  test("should list multiple actors", async () => {
    const actor1: ActorEntity = {
      roleId: 1,
      enabled: true,
    };
    const actor2: ActorEntity = {
      roleId: 1,
      enabled: true,
    };
    const actor3: ActorEntity = {
      roleId: 2,
      enabled: true,
    };

    await db.upsertActor(actor1);
    await db.upsertActor(actor2);
    await db.upsertActor(actor3);

    const actors = await db.listActors();
    expect(actors).toHaveLength(3);
    expect(actors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: actor1.roleId }),
        expect.objectContaining({ roleId: actor2.roleId }),
        expect.objectContaining({ roleId: actor3.roleId }),
      ]),
    );
  });

  test("should handle CRUD operations in sequence", async () => {
    // Create
    const actorData: ActorEntity = {
      roleId: 1,
      enabled: true,
    };
    await db.upsertActor(actorData);

    // Read
    let actor = await db.getActor(1);
    expect(actor).toEqual(
      expect.objectContaining({ roleId: actorData.roleId }),
    );
    expect(typeof actor?.updatedAt).toBe("number");

    // Update
    const updatedActor: ActorEntity = {
      id: 1,
      roleId: 2,
      enabled: true,
    };
    await db.upsertActor(updatedActor);
    actor = await db.getActor(1);
    expect(actor).toEqual(
      expect.objectContaining({ id: 1, roleId: updatedActor.roleId }),
    );
    expect(typeof actor?.updatedAt).toBe("number");

    // Delete
    const deleted = await db.deleteActor(1);
    expect(deleted).toBe(true);
    actor = await db.getActor(1);
    expect(actor).toBeNull();
  });
});
