import type {
  ShortTermMemoryDB,
  ShortTermMemoryEntity,
  ListShortTermMemoriesRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity } from "./mongo.util";

/**
 * MongoDB-based implementation of ShortTermMemoryDB
 * Stores short term memory data in a MongoDB collection
 */
export class MongoShortTermMemoryDB implements ShortTermMemoryDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "short_term_memories";

  /**
   * Creates a new MongoShortTermMemoryDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists short term memories in the database
   * @param req - The request to list short term memories
   * @returns Promise resolving to an array of short term memory data
   */
  async listShortTermMemories(
    req: ListShortTermMemoriesRequest,
  ): Promise<ShortTermMemoryEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<ShortTermMemoryEntity>(
      this.collectionName,
    );

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

    const memories = await collection.find(filter).toArray();

    // Remove MongoDB's _id field from the results
    return memories.map(({ _id, ...memory }) => memory);
  }

  /**
   * Appends a short term memory to the database
   * @param entity - The short term memory to append
   * @returns Promise resolving to the ID of the created memory
   */
  async appendShortTermMemory(entity: ShortTermMemoryEntity): Promise<number> {
    return upsertEntity(this.mongo, this.collectionName, entity, "short_term_memory");
  }

  /**
   * Deletes a short term memory from the database
   * @param id - The unique identifier for the short term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteShortTermMemory(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.collectionName, id);
  }
}
