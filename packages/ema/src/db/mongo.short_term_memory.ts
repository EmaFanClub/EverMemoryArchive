import type {
  ShortTermMemoryDB,
  ShortTermMemoryEntity,
  ListShortTermMemoriesRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of ShortTermMemoryDB.
 */
export class MongoShortTermMemoryDB implements ShortTermMemoryDB {
  private readonly mongo: Mongo;
  /** Collection name. */
  private readonly $cn = "short_term_memories";
  /**
   * The collection names being accessed.
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoShortTermMemoryDB instance.
   * @param mongo - MongoDB instance to use for database operations.
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists short-term memories in the database.
   * @param req - The request to list short-term memories.
   * @returns Promise resolving to an array of short-term memory data.
   */
  async listShortTermMemories(
    req: ListShortTermMemoriesRequest,
  ): Promise<ShortTermMemoryEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<ShortTermMemoryEntity>(this.$cn);

    const filter: Record<string, unknown> = {};
    if (req.actorId !== undefined) {
      if (typeof req.actorId !== "number") {
        throw new Error("actorId must be a number");
      }
      filter.actorId = req.actorId;
    }
    if (req.kind) {
      filter.kind = req.kind;
    }
    if (req.ids !== undefined) {
      filter.id = { $in: req.ids };
    }
    if (req.date !== undefined) {
      filter.date = req.date;
    }
    if (req.dates !== undefined) {
      filter.date = { $in: req.dates };
    }
    if (req.createdBefore !== undefined || req.createdAfter !== undefined) {
      filter.createdAt = {};
      if (req.createdBefore !== undefined) {
        (filter.createdAt as Record<string, unknown>).$lte = req.createdBefore;
      }
      if (req.createdAfter !== undefined) {
        (filter.createdAt as Record<string, unknown>).$gte = req.createdAfter;
      }
    }
    if (req.processed !== undefined) {
      filter.processedAt = req.processed
        ? { $exists: true, $ne: null }
        : { $in: [null, undefined] };
    }
    if (req.visible !== undefined) {
      filter.visible = req.visible ? { $ne: false } : false;
    }

    let cursor = collection.find(filter);
    if (req.sort) {
      cursor = cursor.sort({
        date: req.sort === "asc" ? 1 : -1,
        createdAt: req.sort === "asc" ? 1 : -1,
      });
    }
    if (req.limit !== undefined) {
      cursor = cursor.limit(req.limit);
    }
    return (await cursor.toArray()).map(omitMongoId);
  }

  /**
   * Appends a short-term memory to the database.
   * @param entity - The short-term memory to append.
   * @returns Promise resolving to the ID of the created memory.
   */
  async appendShortTermMemory(entity: ShortTermMemoryEntity): Promise<number> {
    if (entity.id) {
      throw new Error("id must not be provided");
    }
    return this.upsertShortTermMemory(entity);
  }

  /**
   * Upserts a short-term memory in the database.
   * @param entity - The short-term memory to upsert.
   * @returns Promise resolving to the ID of the created or updated memory.
   */
  async upsertShortTermMemory(entity: ShortTermMemoryEntity): Promise<number> {
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes a short-term memory from the database.
   * @param id - The unique identifier for the short-term memory to delete.
   * @returns Promise resolving to true if deleted, false if not found.
   */
  async deleteShortTermMemory(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }

  /**
   * Creates indices for the short-term memories collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<ShortTermMemoryEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex(
      { actorId: 1, kind: 1, date: 1 },
      {
        unique: true,
        partialFilterExpression: {
          kind: { $in: ["day", "month", "year"] },
        },
      },
    );
    await collection.createIndex(
      { actorId: 1, kind: 1, visible: 1, date: -1, createdAt: 1 },
      {},
    );
    await collection.createIndex(
      { actorId: 1, kind: 1, visible: 1, processedAt: 1, date: -1 },
      {},
    );
  }
}
