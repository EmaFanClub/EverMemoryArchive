import { GoogleGenAI } from "@google/genai";
import type {
  SearchLongTermMemoriesRequest,
  LongTermMemoryEntity,
} from "./base";
import type { Mongo } from "./mongo";
import { MongoMemorySearchAdaptor } from "./mongo.long_term_memory";
import * as lancedb from "@lancedb/lancedb";
import { Field, Int64, FixedSizeList, Float32, Schema } from "apache-arrow";

/**
 * The fields of a long term memory that are interested for embedding
 */
export type EmbeddingInterestedLTMFields = Pick<
  SearchLongTermMemoriesRequest,
  "index0" | "index1" | "keywords"
>;

/**
 * Interface for a long term memory embedding engine
 */
export interface LongTermMemoryEmbeddingEngine {
  /**
   * Creates a vector embedding for a long term memory
   * @param dim - The dimension of the vector embedding
   * @param entity - The long term memory to create an embedding for
   * @returns Promise resolving to the vector embedding of the long term memory
   */
  createEmbedding(
    dim: number,
    entity: EmbeddingInterestedLTMFields,
  ): Promise<number[] | undefined>;
}

/**
 * LanceDB-based implementation of LongTermMemorySearcher
 * Uses vector search to find long term memories
 */
export class LanceVectorMemorySearcher extends MongoMemorySearchAdaptor {
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
    const embedding = await this.embeddingEngine.createEmbedding(
      this.$dim,
      req,
    );
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }

    let query = this.indexTable
      .query()
      .where(`actor_id == ${actorId}`)
      .nearestTo(embedding)
      .limit(req.limit ?? 100);

    let ids: { id: number }[] = this.isDebug
      ? await query.toArray()
      : await query.select(["id", "_distance"]).toArray();
    if (this.isDebug) {
      console.log("[LanceVectorMemorySearcher]", ids);
    }

    return ids.map((res) => res.id);
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
      entity,
    );
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }

    await this.indexTable.add([
      {
        id,
        actor_id: actorId,
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
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }
  /**
   * Creates a vector embedding for a long term memory
   * @param dim - The dimension of the vector embedding
   * @param entity - The long term memory to create an embedding for
   * @returns Promise resolving to the vector embedding of the long term memory
   */
  async createEmbedding(
    dim: number,
    entity: EmbeddingInterestedLTMFields,
  ): Promise<number[] | undefined> {
    const embeddingContent = [];
    if (entity.index0) {
      embeddingContent.push(entity.index0);
    }
    if (entity.index1) {
      embeddingContent.push(entity.index1);
    }
    if (entity.keywords) {
      embeddingContent.push(...entity.keywords);
    }
    const response = await this.ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: embeddingContent,
      config: {
        // todo: find the best task type.
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: dim,
      },
    });
    return response.embeddings?.[0]?.values;
  }
}
