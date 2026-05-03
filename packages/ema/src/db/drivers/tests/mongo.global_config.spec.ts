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
      system: {
        httpsProxy: "http://127.0.0.1:7890",
      },
    };

    await db.upsertGlobalConfig(record);
    const first = await db.getGlobalConfig();
    expect(first).toMatchObject({
      id: "global",
      version: 1,
      system: {
        httpsProxy: "http://127.0.0.1:7890",
      },
    });

    await db.upsertGlobalConfig({
      ...record,
      system: {
        httpsProxy: "http://127.0.0.1:7891",
      },
    });
    const second = await db.getGlobalConfig();
    expect(second?.system.httpsProxy).toBe("http://127.0.0.1:7891");
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.updatedAt).toBeGreaterThanOrEqual(first?.updatedAt ?? 0);
  });
});
