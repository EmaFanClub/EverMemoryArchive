import type {
  LongTermMemoryDB,
  LongTermMemoryEntity,
  ListLongTermMemoriesRequest,
} from "./base";
import type { Mongo } from "./mongo";

/**
 * MongoDB-based implementation of LongTermMemoryDB
 * Stores long term memory data in a MongoDB collection
 */
export class MongoLongTermMemoryDB implements LongTermMemoryDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "long_term_memories";

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
    const collection = db.collection<LongTermMemoryEntity>(this.collectionName);

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
   * Appends a long term memory to the database
   * @param entity - The long term memory to append
   * @returns Promise resolving when the operation completes
   */
  async appendLongTermMemory(entity: LongTermMemoryEntity): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryEntity>(this.collectionName);

    // Insert the memory
    await collection.insertOne(entity);
  }

  /**
   * Deletes a long term memory from the database
   * @param id - The unique identifier for the long term memory to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteLongTermMemory(id: string): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<LongTermMemoryEntity>(this.collectionName);

    // Check if memory exists
    const memory = await collection.findOne({ id });

    if (!memory) {
      return false;
    }

    // Delete the memory
    await collection.deleteOne({ id });

    return true;
  }
}
