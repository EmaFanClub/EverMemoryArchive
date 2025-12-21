import { expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  createMongo,
  MongoActorDB,
  MongoShortTermMemoryDB,
  MongoLongTermMemoryDB,
  MongoLongTermMemorySearcher,
} from "../../db";
import type { Mongo } from "../../db";
import { ActorWorker } from "../../actor";

describe("MemorySkill", () => {
  let mongo: Mongo;
  let db: ActorWorker;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    db = new ActorWorker(
      1,
      new MongoActorDB(mongo),
      new MongoShortTermMemoryDB(mongo),
      new MongoLongTermMemoryDB(mongo),
      new MongoLongTermMemorySearcher(mongo),
    );
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should search memory", async () => {
    const result = await db.search(["test"]);
    expect(result).toEqual({ items: [] });
  });
});
