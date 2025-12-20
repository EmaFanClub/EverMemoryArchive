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

    return (await collection.find(filter).toArray()).map(omitMongoId);
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
}
