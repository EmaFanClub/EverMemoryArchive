import type {
  ConversationMessageDB,
  ConversationMessageEntity,
  ListConversationMessagesRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of ConversationMessageDB
 * Stores conversation message data in a MongoDB collection
 */
export class MongoConversationMessageDB implements ConversationMessageDB {
  private readonly mongo: Mongo;
  /** collection name for conversation messages */
  private readonly $cn = "conversation_messages";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoConversationMessageDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists conversation messages in the database
   * @param req - The request to list conversation messages
   * @returns Promise resolving to an array of conversation message data
   */
  async listConversationMessages(
    req: ListConversationMessagesRequest,
  ): Promise<ConversationMessageEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);

    // Build filter based on request
    const filter: any = {};
    if (req.conversationId) {
      if (typeof req.conversationId !== "number") {
        throw new Error("conversationId must be a number");
      }
      filter.conversationId = req.conversationId;
    }
    if (req.createdBefore !== undefined || req.createdAfter !== undefined) {
      if (
        req.createdBefore !== undefined &&
        typeof req.createdBefore !== "number"
      ) {
        throw new Error("createdBefore must be a number");
      }
      if (
        req.createdAfter !== undefined &&
        typeof req.createdAfter !== "number"
      ) {
        throw new Error("createdAfter must be a number");
      }
      const createdAtFilter: { $lte?: number; $gte?: number } = {};
      if (req.createdBefore !== undefined) {
        createdAtFilter.$lte = req.createdBefore;
      }
      if (req.createdAfter !== undefined) {
        createdAtFilter.$gte = req.createdAfter;
      }
      filter.createdAt = createdAtFilter;
    }
    if (req.messageIds !== undefined) {
      if (!Array.isArray(req.messageIds)) {
        throw new Error("messageIds must be an array");
      }
      if (req.messageIds.some((id) => typeof id !== "number")) {
        throw new Error("messageIds must contain only numbers");
      }
      filter.id = { $in: req.messageIds };
    }

    let cursor = collection.find(filter);
    if (req.sort) {
      cursor = cursor.sort({ createdAt: req.sort === "asc" ? 1 : -1 });
    }
    if (req.limit !== undefined) {
      cursor = cursor.limit(req.limit);
    }
    return (await cursor.toArray()).map(omitMongoId);
  }

  /**
   * Counts conversation messages in the database
   * @param conversationId - The conversation ID to count messages for
   * @returns Promise resolving to the number of matching messages
   */
  async countConversationMessages(conversationId: number): Promise<number> {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId must be a number");
    }
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);
    return collection.countDocuments({ conversationId });
  }

  /**
   * Gets a specific conversation message by ID
   * @param id - The unique identifier for the conversation message
   * @returns Promise resolving to the conversation message data or null if not found
   */
  async getConversationMessage(
    id: number,
  ): Promise<ConversationMessageEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);

    const message = await collection.findOne({ id });

    if (!message) {
      return null;
    }

    return omitMongoId(message);
  }

  /**
   * Inserts a conversation message in the database
   * @param entity - The conversation message to add
   * @returns Promise resolving to the ID of the created message
   */
  async addConversationMessage(
    entity: ConversationMessageEntity,
  ): Promise<number> {
    if (entity.id) {
      throw new Error("id must not be provided");
    }
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes a conversation message from the database
   * @param id - The unique identifier for the conversation message to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteConversationMessage(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }

  /**
   * Creates indices for the conversation messages collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ conversationId: 1, createdAt: -1 });
  }
}
