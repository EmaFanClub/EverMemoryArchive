import type { UserDB, UserEntity } from "./base";
import type { Mongo } from "./mongo";

/**
 * MongoDB-based implementation of UserDB
 * Stores user data in a MongoDB collection
 */
export class MongoUserDB implements UserDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "users";

  /**
   * Creates a new MongoUserDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Gets a specific user by ID
   * @param id - The unique identifier for the user
   * @returns Promise resolving to the user data or null if not found
   */
  async getUser(id: string): Promise<UserEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserEntity>(this.collectionName);

    const user = await collection.findOne({ id });

    if (!user) {
      return null;
    }

    // Remove MongoDB's _id field from the result
    const { _id, ...userData } = user;
    return userData;
  }

  /**
   * Inserts or updates a user in the database
   * @param entity - The user data to upsert
   * @returns Promise resolving when the operation completes
   */
  async upsertUser(entity: UserEntity): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserEntity>(this.collectionName);

    // Upsert the user (update if exists, insert if not)
    await collection.updateOne({ id: entity.id }, { $set: entity }, { upsert: true });
  }

  /**
   * Deletes a user from the database
   * @param id - The unique identifier for the user to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteUser(id: string): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserEntity>(this.collectionName);

    // Check if user exists
    const user = await collection.findOne({ id });

    if (!user) {
      return false;
    }

    // Delete the user
    await collection.deleteOne({ id });

    return true;
  }
}
