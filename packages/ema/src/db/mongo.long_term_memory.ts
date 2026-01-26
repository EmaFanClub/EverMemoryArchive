import type {
  LongTermMemoryDB,
  LongTermMemoryEntity,
  ListLongTermMemoriesRequest,
  LongTermMemorySearcher,
  LongTermMemoryIndexer,
  SearchLongTermMemoriesRequest,
  CreatedField,
  DbDate,
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
        // todo: if there are multiple indexers, we need to rollback all of them if any of them fail.
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

  /**
   * Creates indices for the long term memories collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ actorId: 1, createdAt: -1 });
  }
}

/**
 * Abstract base class for MongoDB-backed long term memory search.
 *
 * This adaptor implements {@link LongTermMemorySearcher} by:
 * - delegating to {@link MongoMemorySearchAdaptor.doSearch | doSearch} to perform
 *   vector similarity search and return matching long term memory IDs, and
 * - resolving those IDs into full {@link LongTermMemoryEntity} documents from
 *   the underlying MongoDB collection.
 */
export abstract class MongoMemorySearchAdaptor implements LongTermMemorySearcher {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "long_term_memories";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Indexes a long term memory
   * @param entity - The long term memory to index
   * @returns Promise resolving to void
   */
  abstract indexLongTermMemory(entity: LongTermMemoryEntity): Promise<void>;

  /**
   * Creates the indices for the long term memory vector embedding collection
   */
  abstract createIndices(): Promise<void>;

  /**
   * Searches for long term memories
   *
   * @param req - The request to search for long term memories
   * @returns Promise resolving to an array of long term memory IDs
   */
  abstract doSearch(req: SearchLongTermMemoriesRequest): Promise<number[]>;

  async searchLongTermMemories(
    req: SearchLongTermMemoriesRequest,
  ): Promise<(LongTermMemoryEntity & CreatedField)[]> {
    const idResults = await this.doSearch(req);

    // Convert ids to long term memory entities
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryEntity>(this.$cn);
    const results = await collection.find({ id: { $in: idResults } }).toArray();
    return results.map(omitMongoId).map(checkCreatedField);
  }
}

function checkCreatedField<T extends { createdAt?: DbDate }>(
  entity: T,
): T & CreatedField {
  if (!entity.createdAt) {
    throw new Error("createdAt is required");
  }
  return entity as T & CreatedField;
}
