import type { UserDB, UserEntity } from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of UserDB
 * Stores user data in a MongoDB collection
 */
export class MongoUserDB implements UserDB {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "users";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

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
  async getUser(id: number): Promise<UserEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserEntity>(this.$cn);

    const user = await collection.findOne({ id });

    if (!user) {
      return null;
    }

    return omitMongoId(user);
  }

  /**
   * Inserts or updates a user in the database
   * @param entity - The user data to upsert
   * @returns Promise resolving to the ID of the created or updated user
   */
  async upsertUser(entity: UserEntity): Promise<number> {
    entity.updatedAt = Date.now();
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes a user from the database
   * @param id - The unique identifier for the user to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteUser(id: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, id);
  }

  /**
   * Creates indices for the users collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ email: 1 }, { unique: true });
  }
}
