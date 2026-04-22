import type {
  ExternalIdentityBindingDB,
  ExternalIdentityBindingEntity,
  ListExternalIdentityBindingsRequest,
} from "../base";
import type { Mongo } from "../mongo";
import { deleteEntity, omitMongoId, upsertEntity } from "../mongo/utils";

/**
 * MongoDB-based implementation of ExternalIdentityBindingDB.
 * Stores mappings between local entities and external speakers.
 */
export class MongoExternalIdentityBindingDB implements ExternalIdentityBindingDB {
  private readonly mongo: Mongo;
  /** Collection name for external identity bindings. */
  private readonly $cn = "external_identity_bindings";
  /**
   * The collection names being accessed.
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoExternalIdentityBindingDB instance.
   * @param mongo - MongoDB instance to use for database operations.
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists identity bindings in the database.
   * @param req - Optional filters for the listing.
   * @returns Promise resolving to matching identity bindings.
   */
  async listExternalIdentityBindings(
    req: ListExternalIdentityBindingsRequest,
  ): Promise<ExternalIdentityBindingEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<ExternalIdentityBindingEntity>(this.$cn);
    const filter: Record<string, unknown> = {};
    if (req.userId !== undefined) {
      if (typeof req.userId !== "number") {
        throw new Error("userId must be a number");
      }
      filter.userId = req.userId;
    }
    if (req.channel !== undefined) {
      if (typeof req.channel !== "string") {
        throw new Error("channel must be a string");
      }
      filter.channel = req.channel;
    }
    if (req.uid !== undefined) {
      if (typeof req.uid !== "string") {
        throw new Error("uid must be a string");
      }
      filter.uid = req.uid;
    }
    return (await collection.find(filter).toArray()).map(omitMongoId);
  }

  /**
   * Gets a specific identity binding by ID.
   * @param id - The unique identifier for the binding.
   * @returns Promise resolving to the binding data or null if not found.
   */
  async getExternalIdentityBinding(
    id: number,
  ): Promise<ExternalIdentityBindingEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ExternalIdentityBindingEntity>(this.$cn);
    const binding = await collection.findOne({ id });
    if (!binding) {
      return null;
    }
    return omitMongoId(binding);
  }

  /**
   * Gets an identity binding by external UID.
   * @param uid - External UID.
   * @returns Promise resolving to the binding data or null if not found.
   */
  async getExternalIdentityBindingByUid(
    uid: string,
  ): Promise<ExternalIdentityBindingEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ExternalIdentityBindingEntity>(this.$cn);
    const binding = await collection.findOne({ uid });
    if (!binding) {
      return null;
    }
    return omitMongoId(binding);
  }

  /**
   * Inserts or updates an identity binding.
   * @param entity - The identity binding to upsert.
   * @returns Promise resolving to the created or updated binding ID.
   */
  async upsertExternalIdentityBinding(
    entity: ExternalIdentityBindingEntity,
  ): Promise<number> {
    if (!entity.uid) {
      throw new Error("uid is required");
    }
    if (!entity.channel) {
      throw new Error("channel is required");
    }
    if (!entity.userId || typeof entity.userId !== "number") {
      throw new Error("userId is required");
    }
    const db = this.mongo.getDb();
    const collection = db.collection<ExternalIdentityBindingEntity>(this.$cn);
    if (entity.id === undefined || entity.id === null) {
      const existing = await collection.findOne({
        $or: [
          { uid: entity.uid },
          { userId: entity.userId, channel: entity.channel },
        ],
      });
      if (existing) {
        entity.id = existing.id;
        entity.createdAt = existing.createdAt;
      }
    }
    entity.updatedAt = Date.now();
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes an identity binding.
   * @param id - The unique identifier for the binding to delete.
   * @returns Promise resolving to true if deleted, false if not found.
   */
  async deleteExternalIdentityBinding(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }

  /**
   * Creates indices for the external identity bindings collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<ExternalIdentityBindingEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ uid: 1 }, { unique: true });
    await collection.createIndex({ userId: 1, channel: 1 }, { unique: true });
  }
}
