import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, MongoExternalIdentityBindingDB } from "../..";
import type { Mongo, ExternalIdentityBindingEntity } from "../..";

describe("MongoExternalIdentityBindingDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoExternalIdentityBindingDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new MongoExternalIdentityBindingDB(mongo);
  });

  afterEach(async () => {
    await mongo.close();
  });

  test("should list empty bindings initially", async () => {
    const bindings = await db.listExternalIdentityBindings({});
    expect(bindings).toEqual([]);
  });

  test("should create and fetch a binding by speaker", async () => {
    const binding: ExternalIdentityBindingEntity = {
      userId: 1,
      channel: "qq",
      uid: "qq-654321",
    };

    const id = await db.upsertExternalIdentityBinding(binding);
    expect(id).toBe(1);

    const retrieved = await db.getExternalIdentityBindingByUid("qq-654321");
    expect(retrieved).toMatchObject(binding);
  });

  test("should update an existing binding by speaker", async () => {
    await db.upsertExternalIdentityBinding({
      userId: 1,
      channel: "qq",
      uid: "qq-654321",
    });

    const updated: ExternalIdentityBindingEntity = {
      userId: 1,
      channel: "qq",
      uid: "qq-654321",
    };
    const id = await db.upsertExternalIdentityBinding(updated);
    expect(id).toBe(1);

    const retrieved = await db.getExternalIdentityBindingByUid("qq-654321");
    expect(retrieved).toMatchObject(updated);
  });

  test("should list bindings filtered by entity and speaker", async () => {
    const binding1: ExternalIdentityBindingEntity = {
      userId: 1,
      channel: "web",
      uid: "1",
    };
    const binding2: ExternalIdentityBindingEntity = {
      userId: 1,
      channel: "qq",
      uid: "qq-654321",
    };
    const binding3: ExternalIdentityBindingEntity = {
      userId: 2,
      channel: "qq",
      uid: "qq-654322",
    };

    await db.upsertExternalIdentityBinding(binding1);
    await db.upsertExternalIdentityBinding(binding2);
    await db.upsertExternalIdentityBinding(binding3);

    const byEntity = await db.listExternalIdentityBindings({
      userId: 1,
    });
    expect(byEntity).toHaveLength(2);

    const bySpeaker = await db.listExternalIdentityBindings({
      uid: "qq-654322",
    });
    expect(bySpeaker).toHaveLength(1);
    expect(bySpeaker[0]).toMatchObject(binding3);
  });

  test("should delete a binding", async () => {
    const id = await db.upsertExternalIdentityBinding({
      userId: 1,
      channel: "web",
      uid: "1",
    });

    const deleted = await db.deleteExternalIdentityBinding(id);
    expect(deleted).toBe(true);

    const retrieved = await db.getExternalIdentityBinding(id);
    expect(retrieved).toBeNull();
  });
});
