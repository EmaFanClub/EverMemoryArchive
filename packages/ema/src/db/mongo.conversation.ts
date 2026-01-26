import type {
  ConversationDB,
  ConversationEntity,
  ListConversationsRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of ConversationDB
 * Stores conversation data in a MongoDB collection
 */
export class MongoConversationDB implements ConversationDB {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "conversations";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoConversationDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists conversations in the database
   * @param req - The request to list conversations
   * @returns Promise resolving to an array of conversation data
   */
  async listConversations(
    req: ListConversationsRequest,
  ): Promise<ConversationEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationEntity>(this.$cn);

    // Build filter based on request
    const filter: any = {};
    if (req.actorId) {
      if (typeof req.actorId !== "number") {
        throw new Error("actorId must be a number");
      }
      filter.actorId = req.actorId;
    }
    if (req.userId) {
      if (typeof req.userId !== "number") {
        throw new Error("userId must be a number");
      }
      filter.userId = req.userId;
    }

    return (await collection.find(filter).toArray()).map(omitMongoId);
  }

  /**
   * Gets a specific conversation by ID
   * @param id - The unique identifier for the conversation
   * @returns Promise resolving to the conversation data or null if not found
   */
  async getConversation(id: number): Promise<ConversationEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationEntity>(this.$cn);

    const conversation = await collection.findOne({ id });

    if (!conversation) {
      return null;
    }

    return omitMongoId(conversation);
  }

  /**
   * Inserts or updates a conversation in the database
   * @param entity - The conversation data to upsert
   * @returns Promise resolving to the ID of the created or updated conversation
   */
  async upsertConversation(entity: ConversationEntity): Promise<number> {
    entity.updatedAt = Date.now();
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes a conversation from the database
   * @param id - The unique identifier for the conversation to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteConversation(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }

  /**
   * Creates indices for the conversations collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ actorId: 1, userId: 1 });
    await collection.createIndex({ updatedAt: -1 });
  }
}
