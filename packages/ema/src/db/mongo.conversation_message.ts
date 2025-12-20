import type {
  ConversationMessageDB,
  ConversationMessageEntity,
  ListConversationMessagesRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity } from "./mongo.util";

/**
 * MongoDB-based implementation of ConversationMessageDB
 * Stores conversation message data in a MongoDB collection
 */
export class MongoConversationMessageDB implements ConversationMessageDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "conversation_messages";

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
    const collection = db.collection<ConversationMessageEntity>(
      this.collectionName,
    );

    // Build filter based on request
    const filter: any = {};
    if (req.conversationId) {
      filter.conversationId = req.conversationId;
    }

    const messages = await collection.find(filter).toArray();

    // Remove MongoDB's _id field from the results
    return messages.map(({ _id, ...message }) => message);
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
    const collection = db.collection<ConversationMessageEntity>(
      this.collectionName,
    );

    const message = await collection.findOne({ id });

    if (!message) {
      return null;
    }

    // Remove MongoDB's _id field from the result
    const { _id, ...messageData } = message;
    return messageData;
  }

  /**
   * Inserts a conversation message in the database
   * @param entity - The conversation message to add
   * @returns Promise resolving to the ID of the created message
   */
  async addConversationMessage(entity: ConversationMessageEntity): Promise<number> {
    return upsertEntity(this.mongo, this.collectionName, entity, "conversation_message");
  }

  /**
   * Deletes a conversation message from the database
   * @param id - The unique identifier for the conversation message to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteConversationMessage(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.collectionName, id);
  }
}
