import type { RoleDB, RoleEntity } from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity } from "./mongo.util";

/**
 * MongoDB-based implementation of RoleDB
 * Stores role data in a MongoDB collection
 */
export class MongoRoleDB implements RoleDB {
  private readonly mongo: Mongo;
  private readonly collectionName = "roles";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.collectionName];

  /**
   * Creates a new MongoRoleDB instance
   * @param mongo - MongoDB instance to use for database operations
   */
  constructor(mongo: Mongo) {
    this.mongo = mongo;
  }

  /**
   * Lists all roles in the database
   * @returns Promise resolving to an array of role data
   */
  async listRoles(): Promise<RoleEntity[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleEntity>(this.collectionName);

    const roles = await collection.find().toArray();

    // Remove MongoDB's _id field from the results
    return roles.map(({ _id, ...role }) => role);
  }

  /**
   * Gets a specific role by ID
   * @param roleId - The unique identifier for the role
   * @returns Promise resolving to the role data or null if not found
   */
  async getRole(roleId: number): Promise<RoleEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleEntity>(this.collectionName);

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
  async upsertRole(roleData: RoleEntity): Promise<number> {
    if (!roleData.name || !roleData.description || !roleData.prompt) {
      throw new Error("name, description, and prompt are required");
    }

    return upsertEntity(this.mongo, this.collectionName, roleData, "role");
  }

  /**
   * Deletes a role from the database
   * @param roleId - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteRole(roleId: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.collectionName, roleId);
  }
}
