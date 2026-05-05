import { expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  CompositeLongTermMemoryDB,
  createMongo,
  LanceMemoryVectorIndex,
  MongoLongTermMemoryDB,
} from "../..";

import type {
  LongTermMemoryEmbeddingEngine,
  LongTermMemoryEmbeddingInput,
  LongTermMemoryEntity,
  Mongo,
} from "../..";
import type { EmbeddingConfig } from "../../../config";
import * as lancedb from "@lancedb/lancedb";

class SimpleEmbeddingEngine implements LongTermMemoryEmbeddingEngine {
  async createEmbedding(
    dim: number | undefined,
    input: LongTermMemoryEmbeddingInput,
  ): Promise<number[] | undefined> {
    const text = input;
    const size = dim ?? 8;
    const data = new TextEncoder().encode(text);
    const f32array = Array.from(data).map((byte) => byte / 255);
    while (f32array.length < size) {
      f32array.push(0);
    }
    return f32array.slice(0, size);
  }
}

class FailingEmbeddingEngine implements LongTermMemoryEmbeddingEngine {
  private calls = 0;

  constructor(private readonly failOnCall: number) {}

  async createEmbedding(
    dim: number | undefined,
    input: LongTermMemoryEmbeddingInput,
  ): Promise<number[] | undefined> {
    this.calls += 1;
    if (this.calls === this.failOnCall) {
      throw new Error("embedding failed");
    }
    return new SimpleEmbeddingEngine().createEmbedding(dim, input);
  }
}

describe("LanceMemoryVectorIndex with in-memory LanceDB", () => {
  let mongo: Mongo;
  let lance: lancedb.Connection;
  let db: MongoLongTermMemoryDB;
  let searcher: LanceMemoryVectorIndex;
  const embeddingEngine = new SimpleEmbeddingEngine();
  const embeddingConfig: EmbeddingConfig = {
    provider: "openai",
    openai: {
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    },
    google: {
      model: "",
      baseUrl: "",
      apiKey: "",
      useVertexAi: false,
      project: "",
      location: "",
      credentialsFile: "",
    },
  };
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
    searcher = new LanceMemoryVectorIndex(mongo, lance, embeddingEngine);

    await searcher.ensureVectorIndex(embeddingConfig, []);
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

  test("should index missing long term memories during ensure", async () => {
    const mem11 = memory11();
    mem11.createdAt = Date.now();
    mem11.id = await db.appendLongTermMemory(mem11);

    const status = await searcher.ensureVectorIndex(embeddingConfig, [mem11]);

    expect(status.state).toBe("ready");
    expect(status.totalMemories).toBe(1);
    expect(status.indexedMemories).toBe(1);
    const results = await searcher.searchLongTermMemories({
      actorId: 1,
      memory: "Test statement",
      limit: 10,
    });
    expect(results).toContainEqual(mem11);
  });

  test("composite DB appends to Mongo when vector index failed", async () => {
    const composite = new CompositeLongTermMemoryDB(db, searcher);
    await searcher.ensureVectorIndex(
      {
        ...embeddingConfig,
        openai: { ...embeddingConfig.openai, apiKey: "" },
      },
      [],
    );

    const mem11 = memory11();
    mem11.createdAt = Date.now();
    const id = await composite.appendLongTermMemory(mem11);

    expect(id).toBe(1);
    await expect(db.listLongTermMemories({})).resolves.toContainEqual(mem11);
    await expect(
      composite.searchLongTermMemories({
        actorId: 1,
        memory: "Test statement",
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  test("composite DB appends to Mongo and vector index when ready", async () => {
    const composite = new CompositeLongTermMemoryDB(db, searcher);
    const mem11 = memory11();
    mem11.createdAt = Date.now();

    const id = await composite.appendLongTermMemory(mem11);

    expect(id).toBe(1);
    await expect(
      composite.searchLongTermMemories({
        actorId: 1,
        memory: "Test statement",
        limit: 10,
      }),
    ).resolves.toContainEqual({ ...mem11, id });
    expect(searcher.getVectorIndexStatus()).toMatchObject({
      state: "ready",
      totalMemories: 1,
      indexedMemories: 1,
    });
  });

  test("marks vector index degraded when indexing partially fails", async () => {
    const partialSearcher = new LanceMemoryVectorIndex(
      mongo,
      lance,
      new FailingEmbeddingEngine(3),
    );
    const mem11 = memory11();
    const mem12 = memory12();
    mem11.createdAt = Date.now();
    mem12.createdAt = Date.now();
    mem11.id = await db.appendLongTermMemory(mem11);
    mem12.id = await db.appendLongTermMemory(mem12);

    const status = await partialSearcher.ensureVectorIndex(embeddingConfig, [
      mem11,
      mem12,
    ]);

    expect(status.state).toBe("degraded");
    expect(status.totalMemories).toBe(2);
    expect(status.indexedMemories).toBe(1);
    expect(status.error).toBe("embedding failed");
    await expect(
      partialSearcher.searchLongTermMemories({
        actorId: 1,
        memory: "Test statement",
        limit: 10,
      }),
    ).rejects.toThrow("Long term memory vector index is not ready.");
  });
});
