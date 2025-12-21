import { GoogleGenAI } from "@google/genai";

import type {
  LongTermMemoryDB,
  LongTermMemoryEntity,
  ListLongTermMemoriesRequest,
  LongTermMemorySearcher,
  LongTermMemoryIndexer,
  SearchLongTermMemoriesRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of LongTermMemoryDB
 * Stores long term memory data in a MongoDB collection
 */
export class MongoLongTermMemoryDB implements LongTermMemoryDB {
  /** collection name */
  private readonly $cn = "long_term_memories";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoLongTermMemoryDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(
    private readonly mongo: Mongo,
    private readonly indexers: LongTermMemoryIndexer[] = [],
  ) {}

  /**
   * Lists long term memories in the database
   * @param req - The request to list long term memories
   * @returns Promise resolving to an array of long term memory data
   */
  async listLongTermMemories(
    req: ListLongTermMemoriesRequest,
  ): Promise<LongTermMemoryEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryEntity>(this.$cn);

    // Build filter based on request
    const filter: any = {};
    if (req.actorId) {
      if (typeof req.actorId !== "number") {
        throw new Error("actorId must be a number");
      }
      filter.actorId = req.actorId;
    }
    if (req.createdBefore !== undefined || req.createdAfter !== undefined) {
      filter.createdAt = {};
      if (req.createdBefore !== undefined) {
        filter.createdAt.$lte = req.createdBefore;
      }
      if (req.createdAfter !== undefined) {
        filter.createdAt.$gte = req.createdAfter;
      }
    }

    return (await collection.find(filter).toArray()).map(omitMongoId);
  }

  /**
   * Appends a long term memory to the database
   * @param entity - The long term memory to append
   * @returns Promise resolving to the ID of the created memory
   */
  async appendLongTermMemory(entity: LongTermMemoryEntity): Promise<number> {
    if (entity.id) {
      throw new Error("id must not be provided");
    }
    return this.mongo.getClient().withSession(async () => {
      const id = await upsertEntity(this.mongo, this.$cn, entity);
      const newEntity = { ...entity, id };
      for (const indexer of this.indexers) {
        await indexer.indexLongTermMemory(newEntity);
      }
      return id;
    });
  }

  /**
   * Deletes a long term memory from the database
   * @param id - The unique identifier for the long term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteLongTermMemory(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }
}

/**
 * Represents a vector embedding of a long term memory
 */
interface LongTermMemoryVectorEmbedding {
  /**
   * The unique identifier for the long term memory
   */
  id: number;
  /**
   * The unique identifier for the actor
   */
  actorId: number;
  /**
   * The vector embedding of the long term memory
   */
  embedding: number[];
}

/**
 * The fields of a long term memory that are interested for embedding
 */
type EmbeddingInterestedLTMFields = Pick<
  SearchLongTermMemoriesRequest,
  "index0" | "index1" | "keywords"
>;

/**
 * TODO: this requires atlas deployment
 * MongoDB-based implementation of LongTermMemorySearcher
 * Uses vector search to find long term memories
 */
export class MongoVectorMemorySearcher implements LongTermMemorySearcher {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "long_term_memories";
  /** dim of the vector, See: https://ai.google.dev/gemini-api/docs/embeddings */
  private readonly $dim = 1536;
  /** embedding collection name */
  private readonly $ecn = `long_term_memories$gemini-embedding-001${this.$dim}`;
  /** embdding index name */
  private readonly $ein = "long_term_memory_gemini-embedding-001_1536";
  /** isDebug */
  private readonly isDebug = true;
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn, this.$ecn];

  private readonly ai: GoogleGenAI;

  constructor(mongo: Mongo) {
    this.mongo = mongo;

    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  // todo: fuzzy search
  async searchLongTermMemories(
    req: SearchLongTermMemoriesRequest,
  ): Promise<LongTermMemoryEntity[]> {
    const db = this.mongo.getDb();
    const index = db.collection<LongTermMemoryVectorEmbedding>(this.$ecn);

    if (!req.actorId) {
      throw new Error("actorId must be provided");
    }
    const embedding = await this.createEmbedding(req);
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }

    const agg = [
      // find by actor id
      {
        $match: {
          actorId: req.actorId,
        },
      },
      // find by embedding
      {
        $search: {
          index: this.$ein,
          path: "embedding",
          queryVector: embedding,
          // what's it?
          numCandidates: 150,
          limit: req.limit,
        },
      },
      {
        $project: this.isDebug
          ? {
              id: 1,
              actorId: 1,
              embedding: 1,
              score: {
                $meta: "vectorSearchScore",
              },
            }
          : {
              id: 1,
              actorId: 0,
              embedding: 0,
            },
      },
    ];

    const idResults = await index.aggregate(agg).toArray();
    if (this.isDebug) {
      console.log("[MongoVectorMemorySearcher]", idResults);
    }
    //  find by id
    const collection = db.collection<LongTermMemoryEntity>(this.$cn);
    const results = await collection
      .find({ id: { $in: idResults.map((result) => result.id) } })
      .toArray();
    return results.map(omitMongoId);
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

    const embedding = await this.createEmbedding(entity);
    if (!embedding) {
      return;
    }
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryVectorEmbedding>(this.$ecn);
    await collection.insertOne({ id, actorId, embedding });
  }

  /**
   * Creates the indices for the long term memory vector embedding collection
   */
  async createIndices() {
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryVectorEmbedding>(this.$ecn);

    await collection.createSearchIndex({
      name: this.$ein,
      type: "vectorSearch",
      definition: {
        fields: [
          {
            type: "vector",
            numDimensions: this.$dim,
            path: "embedding",
            similarity: "dotProduct",
            quantization: "scalar",
          },
        ],
      },
    });
  }

  /**
   * Creates a vector embedding for a long term memory
   * @param entity - The long term memory to create an embedding for
   * @returns Promise resolving to the vector embedding of the long term memory
   */
  async createEmbedding(
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
        taskType: "RETRIEVAL_QUERY",
      },
    });
    return response.embeddings?.[0]?.values;
  }
}
