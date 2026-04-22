import type { PersonalityDB, PersonalityEntity } from "../base";
import type { Mongo } from "../mongo";
import { deleteEntity, omitMongoId, upsertEntity } from "../mongo/utils";

/**
 * MongoDB-based implementation of PersonalityDB
 * Stores personality data in a MongoDB collection
 */
export class MongoPersonalityDB implements PersonalityDB {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "personalities";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoPersonalityDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists all personalities in the database
   * @returns Promise resolving to an array of personality data
   */
  async listPersonalities(): Promise<PersonalityEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<PersonalityEntity>(this.$cn);
    return (await collection.find().toArray()).map(omitMongoId);
  }

  /**
   * Gets personality by actor id
   * @param actorId - The unique identifier for the actor
   * @returns Promise resolving to the personality data or null if not found
   */
  async getPersonality(actorId: number): Promise<PersonalityEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<PersonalityEntity>(this.$cn);
    const personality = await collection.findOne({ actorId });
    if (!personality) {
      return null;
    }
    return omitMongoId(personality);
  }

  /**
   * Inserts or updates personality in the database
   * @param entity - The personality data to upsert
   * @returns Promise resolving to the ID of the created or updated personality
   * @throws Error if actorId or memory are missing
   */
  async upsertPersonality(entity: PersonalityEntity): Promise<number> {
    if (!entity.actorId || typeof entity.actorId !== "number") {
      throw new Error("actorId is required");
    }
    if (!entity.memory) {
      throw new Error("memory is required");
    }
    const db = this.mongo.getDb();
    const collection = db.collection<PersonalityEntity>(this.$cn);
    if (entity.id === undefined || entity.id === null) {
      const existing = await collection.findOne({ actorId: entity.actorId });
      if (existing) {
        entity.id = existing.id;
        entity.createdAt = existing.createdAt;
      }
    }
    entity.updatedAt = Date.now();
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes personality by actor id
   * @param actorId - The unique identifier for the actor
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deletePersonality(actorId: number): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<PersonalityEntity>(this.$cn);
    const existing = await collection.findOne({ actorId });
    if (!existing || typeof existing.id !== "number") {
      return false;
    }
    return deleteEntity(this.mongo, this.$cn, existing.id);
  }

  /**
   * Creates indices for the personalities collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<PersonalityEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ actorId: 1 }, { unique: true });
  }
}
