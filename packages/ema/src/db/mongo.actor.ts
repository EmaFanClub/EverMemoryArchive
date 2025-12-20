import type { ActorDB, ActorEntity } from "./base";
import type { Mongo } from "./mongo";

/**
 * MongoDB-based implementation of ActorDB
 * Stores actor data in a MongoDB collection
 */
export class MongoActorDB implements ActorDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "actors";

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
    const collection = db.collection<ActorEntity>(this.collectionName);

    const actors = await collection.find().toArray();

    // Remove MongoDB's _id field from the results
    return actors.map(({ _id, ...actor }) => actor);
  }

  /**
   * Gets a specific actor by ID
   * @param id - The unique identifier for the actor
   * @returns Promise resolving to the actor data or null if not found
   */
  async getActor(id: string): Promise<ActorEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<ActorEntity>(this.collectionName);

    const actor = await collection.findOne({ id });

    if (!actor) {
      return null;
    }

    // Remove MongoDB's _id field from the result
    const { _id, ...actorData } = actor;
    return actorData;
  }

  /**
   * Inserts or updates an actor in the database
   * @param entity - The actor data to upsert
   * @returns Promise resolving when the operation completes
   */
  async upsertActor(entity: ActorEntity): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<ActorEntity>(this.collectionName);

    // Upsert the actor (update if exists, insert if not)
    await collection.updateOne({ id: entity.id }, { $set: entity }, { upsert: true });
  }

  /**
   * Deletes an actor from the database
   * @param id - The unique identifier for the actor to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteActor(id: string): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<ActorEntity>(this.collectionName);

    // Check if actor exists
    const actor = await collection.findOne({ id });

    if (!actor) {
      return false;
    }

    // Delete the actor
    await collection.deleteOne({ id });

    return true;
  }
}
