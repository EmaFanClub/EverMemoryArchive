import type { ActorDB, ActorEntity } from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of ActorDB
 * Stores actor data in a MongoDB collection
 */
export class MongoActorDB implements ActorDB {
  private readonly mongo: Mongo;
  /** collection name for actors */
  private readonly $cn = "actors";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoActorDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists all actors in the database
   * @returns Promise resolving to an array of actor data
   */
  async listActors(): Promise<ActorEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<ActorEntity>(this.$cn);

    return (await collection.find().toArray()).map(omitMongoId);
  }

  /**
   * Gets a specific actor by ID
   * @param id - The unique identifier for the actor
   * @returns Promise resolving to the actor data or null if not found
   */
  async getActor(id: number): Promise<ActorEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ActorEntity>(this.$cn);

    const actor = await collection.findOne({ id });

    if (!actor) {
      return null;
    }

    return omitMongoId(actor);
  }

  /**
   * Inserts or updates an actor in the database
   * @param entity - The actor data to upsert
   * @returns Promise resolving to the ID of the created or updated actor
   */
  async upsertActor(entity: ActorEntity): Promise<number> {
    entity.updatedAt = Date.now();
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes an actor from the database
   * @param id - The unique identifier for the actor to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteActor(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }

  /**
   * Creates indices for the actors collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<ActorEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
  }
}
