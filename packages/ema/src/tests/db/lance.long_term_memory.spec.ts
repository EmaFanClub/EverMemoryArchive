import { expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  createMongo,
  LanceMemoryVectorSearcher,
  MongoLongTermMemoryDB,
} from "../../db";

import type {
  LongTermMemoryEmbeddingEngine,
  LongTermMemoryEmbeddingInput,
  LongTermMemoryEntity,
  Mongo,
} from "../../db";
import * as lancedb from "@lancedb/lancedb";

class SimpleEmbeddingEngine implements LongTermMemoryEmbeddingEngine {
  async createEmbedding(
    dim: number,
    input: LongTermMemoryEmbeddingInput,
  ): Promise<number[] | undefined> {
    const text = input;
    const data = new TextEncoder().encode(text);
    const f32array = Array.from(data).map((byte) => byte / 255);
    while (f32array.length < dim) {
      f32array.push(0);
    }
    return f32array.slice(0, dim);
  }
}

describe("LanceMemoryVectorSearcher with in-memory LanceDB", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let db: MongoLongTermMemoryDB;
  let searcher: LanceMemoryVectorSearcher;
  const embeddingEngine = new SimpleEmbeddingEngine();
  const 绘画 = {
    index0: "绘画",
    index1: "水墨画",
  };
  const 书法 = {
    index0: "书法",
    index1: "楷书",
  };

  const memory11 = (): LongTermMemoryEntity => ({
    actorId: 1,
    memory: "Test statement",
    messages: [1, 2],
    ...绘画,
  });
  const memory12 = (): LongTermMemoryEntity => ({
    actorId: 1,
    memory: "Test statement 2",
    messages: [3, 4],
    ...书法,
  });
  const memory21 = (): LongTermMemoryEntity => ({
    actorId: 2,
    memory: "Test statement 3",
    messages: [1, 2],
    ...绘画,
  });
  const memory22 = (): LongTermMemoryEntity => ({
    actorId: 2,
    memory: "Test statement 4",
    messages: [3, 4],
    ...书法,
  });

  beforeEach(async () => {
    // Create in-memory MongoDB instance for testing
    mongo = await createMongo("", "test", "memory");
    await mongo.connect();
    lance = await lancedb.connect("memory://ema");
    db = new MongoLongTermMemoryDB(mongo);
    searcher = new LanceMemoryVectorSearcher(mongo, lance, embeddingEngine);

    await searcher.createIndices();
  });

  afterEach(async () => {
    await mongo.close();
    await lance.close();
  });

  test("should search long term memories", async () => {
    const memories = await searcher.searchLongTermMemories({
      actorId: 1,
      memory: "test",
      limit: 10,
    });
    expect(memories).toEqual([]);
  });

  test("should search long term memories", async () => {
    const mem11 = memory11();
    const mem21 = memory21();
    const mem12 = memory12();
    const mem22 = memory22();

    for (const mem of [mem11, mem21, mem12, mem22]) {
      mem.id = await db.appendLongTermMemory(mem);
      await searcher.indexLongTermMemory(mem);
    }

    // Validates actor and index filters
    const results = await searcher.searchLongTermMemories({
      actorId: 1,
      memory: "Test statement",
      limit: 10,
      index0: "绘画",
      index1: "水墨画",
    });
    expect(results).toContainEqual(mem11);
    expect(results).not.toContainEqual(mem12);
    expect(results).not.toContainEqual(mem21);
    expect(results).not.toContainEqual(mem22);
  });
});
