import type {
  LongTermMemoryDB,
  LongTermMemoryEntity,
  ListLongTermMemoriesRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of LongTermMemoryDB
 * Stores long term memory data in a MongoDB collection
 */
export class MongoLongTermMemoryDB implements LongTermMemoryDB {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "long_term_memories";

  /**
   * Creates a new MongoLongTermMemoryDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

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
    return upsertEntity(this.mongo, this.$cn, entity);
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
