import type { RoleDB, RoleData } from "./base";
import type { Mongo } from "./mongo";

/**
 * Counter document interface for MongoDB
 */
interface CounterDocument {
  _id: string;
  seq: number;
}

/**
 * MongoDB-based implementation of RoleDB
 * Stores role data in a MongoDB collection
 */
export class MongoRoleDB implements RoleDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "roles";
  private readonly counterCollectionName = "counters";

  /**
   * Creates a new MongoRoleDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Gets the next role ID using MongoDB's counter pattern
   * @returns Promise resolving to the next role ID as a number
   */
  private async getNextId(kind: string): Promise<number> {
    const db = this.mongo.getDb();
    const counters = db.collection<CounterDocument>(this.counterCollectionName);

    const result = await counters.findOneAndUpdate(
      { _id: kind },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );

    if (!result || result.seq == null) {
      throw new Error(`Failed to generate next ID for kind "${kind}"`);
    }

    return result.seq;
  }

  /**
   * Lists all roles in the database
   * Excludes soft-deleted roles (those with deleteTime set)
   * @returns Promise resolving to an array of role data
   */
  async listRoles(): Promise<RoleData[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleData>(this.collectionName);

    const roles = await collection.find().toArray();

    // Remove MongoDB's _id field from the results
    return roles.map(({ _id, ...role }) => role);
  }

  /**
   * Gets a specific role by ID
   * Returns null if the role doesn't exist or is soft-deleted
   * @param roleId - The unique identifier for the role
   * @returns Promise resolving to the role data or null if not found
   */
  async getRole(roleId: number): Promise<RoleData | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleData>(this.collectionName);

    const role = await collection.findOne({ id: roleId });

    if (!role) {
      return null;
    }

    // Remove MongoDB's _id field from the result
    const { _id, ...roleData } = role;
    return roleData;
  }

  /**
   * Inserts or updates a role in the database
   * If the role doesn't have an ID, a new one is generated
   * @param roleData - The role data to upsert
   * @returns Promise resolving to the ID of the created or updated role
   * @throws Error if name, description, or prompt are missing
   */
  async upsertRole(roleData: RoleData): Promise<number> {
    if (!roleData.name || !roleData.description || !roleData.prompt) {
      throw new Error("name, description, and prompt are required");
    }

    const db = this.mongo.getDb();
    const collection = db.collection<RoleData>(this.collectionName);

    // Generate ID if not provided
    if (!roleData.id) {
      roleData.id = await this.getNextId("role");
    }

    // Upsert the role (update if exists, insert if not)
    await collection.updateOne(
      { id: roleData.id },
      { $set: roleData },
      { upsert: true },
    );

    return roleData.id;
  }

  /**
   * Hard deletes a role by removing it from the database
   * @param roleId - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteRole(roleId: number): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleData>(this.collectionName);

    // Check if role exists and is not already deleted
    const role = await collection.findOne({ id: roleId });

    if (!role) {
      return false;
    }

    // Hard delete: remove the role
    await collection.deleteOne({ id: roleId });

    return true;
  }
}
