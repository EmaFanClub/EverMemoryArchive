import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestGlobalConfigRecord } from "../../../config/tests/helpers";
import { createMongo, MongoGlobalConfigDB, type Mongo } from "../..";

describe("MongoGlobalConfigDB with in-memory MongoDB", () => {
  let mongo: Mongo;
  let db: MongoGlobalConfigDB;

  beforeEach(async () => {
    mongo = await createMongo("", "test_global_config", "memory");
    await mongo.connect();
    db = new MongoGlobalConfigDB(mongo);
  });

  afterEach(async () => {
    await mongo.close();
  });

  test("should return null before setup writes global config", async () => {
    await expect(db.getGlobalConfig()).resolves.toBeNull();
  });

  test("should upsert and read the singleton global config", async () => {
    const record = {
      ...createTestGlobalConfigRecord(),
      accessToken: "token-1",
    };

    await db.upsertGlobalConfig(record);
    const first = await db.getGlobalConfig();
    expect(first).toMatchObject({
      id: "global",
      version: 1,
      accessToken: "token-1",
    });

    await db.upsertGlobalConfig({
      ...record,
      accessToken: "token-2",
    });
    const second = await db.getGlobalConfig();
    expect(second?.accessToken).toBe("token-2");
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
  });
});
