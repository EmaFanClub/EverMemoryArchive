import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { createMongo, LanceVectorMemorySearcher } from "../../db";
import type { Mongo } from "../../db";
import * as lancedb from "@lancedb/lancedb";

const describeLLM = describe.runIf(process.env.ENABLE_LLM_TESTS === "true");
describeLLM("MongoVectorMemorySearcher with in-memory MongoDB", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let indexer: LanceVectorMemorySearcher;

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://test");
    indexer = new LanceVectorMemorySearcher(mongo, lance);

    await indexer.createIndices();
  });

  afterEach(async () => {
    // Clean up: close MongoDB connection
    await mongo.close();
  });

  test("should search long term memories", async () => {
    const memories = await indexer.searchLongTermMemories({
      actorId: 1,
    });
    expect(memories).toEqual([]);
  });

  const paintVector: number[] = [];

  test("should search long term memories with index0", async () => {
    const embedding = await indexer.createEmbedding({
      index0: "绘画",
      index1: "水墨画",
      keywords: ["山水画", "花鸟画"],
    });
    expect(embedding).toEqual(paintVector);
  });
});
