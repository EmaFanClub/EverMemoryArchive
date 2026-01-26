import type {
  UserOwnActorDB,
  UserOwnActorRelation,
  ListUserOwnActorRelationsRequest,
} from "./base";
import type { Mongo } from "./mongo";
import { omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of UserOwnActorDB
 * Stores user own actor relations in a MongoDB collection
 */
export class MongoUserOwnActorDB implements UserOwnActorDB {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "user_own_actors";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoUserOwnActorDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists user own actor relations by user id or actor id
   * @param req - The request to list user own actor relations
   * @returns Promise resolving to an array of user own actor relation data
   */
  async listUserOwnActorRelations(
    req: ListUserOwnActorRelationsRequest,
  ): Promise<UserOwnActorRelation[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserOwnActorRelation>(this.$cn);

    // Build filter based on request
    const filter: any = {};
    if (req.userId) {
      if (typeof req.userId !== "number") {
        throw new Error("userId must be a number");
      }
      filter.userId = req.userId;
    }
    if (req.actorId) {
      if (typeof req.actorId !== "number") {
        throw new Error("actorId must be a number");
      }
      filter.actorId = req.actorId;
    }

    return (await collection.find(filter).toArray()).map(omitMongoId);
  }

  /**
   * Adds an actor to a user
   * @param entity - The user own actor relation data to add
   * @returns Promise resolving to true if added, false if already exists
   */
  async addActorToUser(entity: UserOwnActorRelation): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserOwnActorRelation>(this.$cn);

    // Check if relation already exists
    const existing = await collection.findOne({
      userId: entity.userId,
      actorId: entity.actorId,
    });

    if (existing) {
      return false;
    }

    // Insert the relation
    await collection.insertOne({ ...entity });

    return true;
  }

  /**
   * Removes an actor from a user
   * @param entity - The user own actor relation data to remove
   * @returns Promise resolving to true if removed, false if not found
   */
  async removeActorFromUser(entity: UserOwnActorRelation): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserOwnActorRelation>(this.$cn);

    // Delete the relation
    const result = await collection.deleteOne({
      userId: entity.userId,
      actorId: entity.actorId,
    });

    return result.deletedCount > 0;
  }

  /**
   * Creates indices for the user-own-actors collection.
   * @returns Promise resolving when indices are created.
   */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<UserOwnActorRelation>(this.$cn);
    await collection.createIndex({ userId: 1, actorId: 1 }, { unique: true });
    await collection.createIndex({ userId: 1 });
    await collection.createIndex({ actorId: 1 });
  }
}
