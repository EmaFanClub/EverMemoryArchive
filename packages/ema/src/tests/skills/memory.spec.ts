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
import { Config } from "../../config";

describe("MemorySkill", () => {
  const { shouldSkip, skipReason } = (() => {
    try {
      Config.load();
      return { shouldSkip: false, skipReason: "" };
    } catch (error) {
      return {
        shouldSkip: true,
        skipReason: `Config load failed: ${(error as Error).message}`,
      };
    }
  })();

  if (shouldSkip) {
    test.skip("skipped because " + skipReason, () => {});
    return;
  }

  let mongo: Mongo;
  let worker: ActorWorker;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    worker = new ActorWorker(
      Config.load(),
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
    const result = await worker.search(["test"]);
    expect(result).toEqual({ items: [] });
  });

  test("should mock search memory", async () => {
    const item = {
      index0: "test",
      index1: "test",
      keywords: ["test"],
      os: "test",
      statement: "test",
      createdAt: Date.now(),
    };
    worker.search = vi.fn().mockResolvedValue({
      items: [item],
    });
    const result = await worker.search(["test"]);
    expect(result).toEqual({ items: [item] });
  });
});
