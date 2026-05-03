import type {
  ConversationMessageDB,
  ConversationMessageEntity,
  ListConversationMessagesRequest,
} from "../base";
import type { Mongo } from "../mongo";
import {
  deleteEntity,
  getNextId,
  omitMongoId,
  upsertEntity,
} from "../mongo/utils";

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
    if (req.actorId !== undefined) {
      if (typeof req.actorId !== "number") {
        throw new Error("actorId must be a number");
      }
      filter.actorId = req.actorId;
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
    if (req.msgIds !== undefined) {
      if (!Array.isArray(req.msgIds)) {
        throw new Error("msgIds must be an array");
      }
      if (req.msgIds.some((id) => typeof id !== "number")) {
        throw new Error("msgIds must contain only numbers");
      }
      filter.msgId = { $in: req.msgIds };
    }
    if (req.channelMessageId !== undefined) {
      if (typeof req.channelMessageId !== "string") {
        throw new Error("channelMessageId must be a string");
      }
      filter.channelMessageId = req.channelMessageId;
    }
    if (req.buffered !== undefined) {
      if (typeof req.buffered !== "boolean") {
        throw new Error("buffered must be a boolean");
      }
      filter.buffered = req.buffered ? { $ne: false } : false;
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
   * @param buffered - Optional buffered-state filter
   * @returns Promise resolving to the number of matching messages
   */
  async countConversationMessages(
    conversationId: number,
    buffered?: boolean,
  ): Promise<number> {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId must be a number");
    }
    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);
    return collection.countDocuments({
      conversationId,
      ...(buffered === undefined
        ? {}
        : { buffered: buffered ? { $ne: false } : false }),
    });
  }

  async reserveMessageId(actorId: number): Promise<number> {
    if (typeof actorId !== "number") {
      throw new Error("actorId must be a number");
    }
    return getNextId(this.mongo, `${this.$cn}:actor:${actorId}`);
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
    entity: Omit<ConversationMessageEntity, "id" | "msgId"> & {
      msgId?: number;
    },
  ): Promise<ConversationMessageEntity & { id: number; msgId: number }> {
    if ((entity as ConversationMessageEntity).id) {
      throw new Error("id must not be provided");
    }
    const nextMsgId =
      entity.msgId ?? (await this.reserveMessageId(entity.actorId));
    const storedEntity: ConversationMessageEntity = {
      ...entity,
      msgId: nextMsgId,
    };
    const id = await upsertEntity(this.mongo, this.$cn, storedEntity);
    return {
      ...storedEntity,
      id,
      msgId: nextMsgId,
    };
  }

  async updateConversationMessageChannelMessageId(
    conversationId: number,
    msgId: number,
    channelMessageId: string,
  ): Promise<boolean> {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId must be a number");
    }
    if (typeof msgId !== "number") {
      throw new Error("msgId must be a number");
    }
    if (typeof channelMessageId !== "string") {
      throw new Error("channelMessageId must be a string");
    }

    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);
    const result = await collection.updateOne(
      { conversationId, msgId },
      {
        $set: {
          channelMessageId,
        },
      },
    );
    return result.matchedCount > 0;
  }

  async markConversationMessagesBuffered(
    conversationId: number,
    msgIds: number[],
  ): Promise<number> {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId must be a number");
    }
    if (!Array.isArray(msgIds)) {
      throw new Error("msgIds must be an array");
    }
    if (msgIds.some((id) => typeof id !== "number")) {
      throw new Error("msgIds must contain only numbers");
    }
    if (msgIds.length === 0) {
      return 0;
    }

    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);
    const result = await collection.updateMany(
      {
        conversationId,
        msgId: { $in: msgIds },
      },
      {
        $set: {
          buffered: true,
        },
      },
    );
    return result.modifiedCount;
  }

  async markConversationMessagesActivityProcessed(
    conversationId: number,
    msgIds: number[],
    processedAt: number,
  ): Promise<number> {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId must be a number");
    }
    if (!Array.isArray(msgIds)) {
      throw new Error("msgIds must be an array");
    }
    if (msgIds.some((id) => typeof id !== "number")) {
      throw new Error("msgIds must contain only numbers");
    }
    if (typeof processedAt !== "number") {
      throw new Error("processedAt must be a number");
    }
    if (msgIds.length === 0) {
      return 0;
    }

    const db = this.mongo.getDb();
    const collection = db.collection<ConversationMessageEntity>(this.$cn);
    const result = await collection.updateMany(
      {
        conversationId,
        msgId: { $in: msgIds },
      },
      {
        $set: {
          activityProcessedAt: processedAt,
        },
      },
    );
    return result.modifiedCount;
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
    await collection.createIndex({
      conversationId: 1,
      buffered: 1,
      createdAt: -1,
    });
    await collection.createIndex({
      conversationId: 1,
      buffered: 1,
      activityProcessedAt: 1,
      createdAt: -1,
    });
    await collection.createIndex({ actorId: 1, msgId: 1 }, { unique: true });
    await collection.createIndex({ conversationId: 1, channelMessageId: 1 });
  }
}
