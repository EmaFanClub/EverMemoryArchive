import { GoogleGenAI } from "@google/genai";
import type {
  SearchLongTermMemoriesRequest,
  LongTermMemoryEntity,
} from "./base";
import type { Mongo } from "./mongo";
import { MongoMemorySearchAdaptor } from "./mongo.long_term_memory";
import * as lancedb from "@lancedb/lancedb";
import {
  Field,
  Int64,
  FixedSizeList,
  Float32,
  Schema,
  Utf8,
} from "apache-arrow";

import { FetchWithProxy } from "../llm/proxy";
import { GenAI } from "../llm/google_client";
import { type GoogleGenAIOptions } from "@google/genai";

/**
 * The text input used to compute an embedding.
 */
export type LongTermMemoryEmbeddingInput = string;

/**
 * Interface for a long term memory embedding engine
 */
export interface LongTermMemoryEmbeddingEngine {
  /**
   * Creates a vector embedding for a long term memory
   * @param dim - The dimension of the vector embedding
   * @param input - The text input to embed
   * @returns Promise resolving to the vector embedding of the long term memory
   */
  createEmbedding(
    dim: number,
    input: LongTermMemoryEmbeddingInput,
  ): Promise<number[] | undefined>;
}

/**
 * LanceDB-based implementation of LongTermMemorySearcher
 * Uses vector search to find long term memories
 */
export class LanceMemoryVectorSearcher extends MongoMemorySearchAdaptor {
  /** dim of the vector, See: https://ai.google.dev/gemini-api/docs/embeddings */
  private readonly $dim = 1536;
  /** isDebug */
  private readonly isDebug = false;
  /** index table name */
  private readonly $itn = `long_term_memories_gemini-embedding-001_${this.$dim}`;
  /** index table */
  private indexTable!: lancedb.Table;

  constructor(
    mongo: Mongo,
    private readonly lancedb: lancedb.Connection,
    private readonly embeddingEngine: LongTermMemoryEmbeddingEngine = new LongTermMemoryGeminiEmbeddingEngine(),
  ) {
    super(mongo);
  }

  async doSearch(req: SearchLongTermMemoriesRequest): Promise<number[]> {
    const actorId = req.actorId;
    if (!actorId || typeof actorId !== "number") {
      throw new Error("actorId must be provided");
    }
    if (!req.memory) {
      throw new Error("memory must be provided");
    }
    const embedding = await this.embeddingEngine.createEmbedding(
      this.$dim,
      req.memory,
    );
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }

    const filters = [`actor_id = ${actorId}`];
    if (req.index0) {
      filters.push(`index0 = '${escapeWhereValue(req.index0)}'`);
    }
    if (req.index1) {
      filters.push(`index1 = '${escapeWhereValue(req.index1)}'`);
    }
    let query = this.indexTable
      .query()
      .where(filters.join(" AND "))
      .nearestTo(embedding)
      .limit(req.limit);

    let ids: { id: number }[] = this.isDebug
      ? await query.toArray()
      : await query.select(["id", "_distance"]).toArray();
    if (this.isDebug) {
      console.log("[LanceMemoryVectorSearcher]", ids);
    }

    return ids.map((res) =>
      typeof res.id === "bigint" ? Number(res.id) : res.id,
    );
  }

  /**
   * Indexes a long term memory
   * @param entity - The long term memory to index
   * @returns Promise resolving to void
   */
  async indexLongTermMemory(entity: LongTermMemoryEntity): Promise<void> {
    const id = entity.id;
    if (!id) {
      throw new Error("id must be provided");
    }
    const actorId = entity.actorId;
    if (!actorId) {
      throw new Error("actorId must be provided");
    }

    const embedding = await this.embeddingEngine.createEmbedding(
      this.$dim,
      entity.memory,
    );
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }

    await this.indexTable.add([
      {
        id,
        actor_id: actorId,
        index0: entity.index0,
        index1: entity.index1,
        embedding,
      },
    ]);
  }

  /**
   * Creates the indices for the long term memory vector embedding collection
   */
  async createIndices() {
    // todo: pull all data that is not in lancedb from mongodb

    const hasThisTable = await this.lancedb
      .tableNames()
      .then((names) => names.includes(this.$itn));
    if (hasThisTable) {
      this.indexTable = await this.lancedb.openTable(this.$itn);
    } else {
      this.indexTable = await this.lancedb.createEmptyTable(
        this.$itn,
        new Schema([
          new Field("id", new Int64(), false),
          new Field("actor_id", new Int64(), false),
          new Field("index0", new Utf8(), false),
          new Field("index1", new Utf8(), false),
          new Field(
            "embedding",
            new FixedSizeList(
              this.$dim,
              new Field("item", new Float32(), false),
            ),
            false,
          ),
        ]),
      );
    }
  }
}

/**
 * Implementation of the long term memory embedding engine using Gemini
 */
class LongTermMemoryGeminiEmbeddingEngine implements LongTermMemoryEmbeddingEngine {
  private readonly ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    const vertexAIOptions = {
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    };
    const googleAIOptions = {
      apiKey: apiKey,
    };
    const options: GoogleGenAIOptions =
      process.env.GOOGLE_GENAI_USE_VERTEXAI === "True"
        ? vertexAIOptions
        : googleAIOptions;
    console.log("GoogleClient options:", options);
    this.ai = new GenAI(
      options,
      new FetchWithProxy(
        process.env.HTTPS_PROXY || process.env.https_proxy,
      ).createFetcher(),
    );
  }
  /**
   * Creates a vector embedding for a long term memory
   * @param dim - The dimension of the vector embedding
   * @param entity - The long term memory to create an embedding for
   * @returns Promise resolving to the vector embedding of the long term memory
   */
  async createEmbedding(
    dim: number,
    input: LongTermMemoryEmbeddingInput,
  ): Promise<number[] | undefined> {
    const embeddingContent = input.trim();
    if (!embeddingContent) {
      return undefined;
    }
    const response = await this.ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: [embeddingContent],
      config: {
        // todo: find the best task type.
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: dim,
      },
    });
    return response.embeddings?.[0]?.values;
  }
}

function escapeWhereValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
