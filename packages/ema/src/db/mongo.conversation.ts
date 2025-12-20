import type {
  ConversationDB,
  ConversationEntity,
  ListConversationsRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity } from "./mongo.util";

/**
 * MongoDB-based implementation of ConversationDB
 * Stores conversation data in a MongoDB collection
 */
export class MongoConversationDB implements ConversationDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "conversations";

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
    const collection = db.collection<ConversationEntity>(this.collectionName);

    // Build filter based on request
    const filter: any = {};
    if (req.actorId) {
      filter.actorId = req.actorId;
    }
    if (req.userId) {
      filter.userId = req.userId;
    }

    const conversations = await collection.find(filter).toArray();

    // Remove MongoDB's _id field from the results
    return conversations.map(({ _id, ...conversation }) => conversation);
  }

  /**
   * Gets a specific conversation by ID
   * @param id - The unique identifier for the conversation
   * @returns Promise resolving to the conversation data or null if not found
   */
  async getConversation(id: number): Promise<ConversationEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationEntity>(this.collectionName);

    const conversation = await collection.findOne({ id });

    if (!conversation) {
      return null;
    }

    // Remove MongoDB's _id field from the result
    const { _id, ...conversationData } = conversation;
    return conversationData;
  }

  /**
   * Inserts or updates a conversation in the database
   * @param entity - The conversation data to upsert
   * @returns Promise resolving to the ID of the created or updated conversation
   */
  async upsertConversation(entity: ConversationEntity): Promise<number> {
    return upsertEntity(this.mongo, this.collectionName, entity, "conversation");
  }

  /**
   * Deletes a conversation from the database
   * @param id - The unique identifier for the conversation to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteConversation(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.collectionName, id);
  }
}
