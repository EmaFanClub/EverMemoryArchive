import type { RoleDB, RoleEntity } from "./base";
import type { Mongo } from "./mongo";
import { upsertEntity, deleteEntity, omitMongoId } from "./mongo.util";

/**
 * MongoDB-based implementation of RoleDB
 * Stores role data in a MongoDB collection
 */
export class MongoRoleDB implements RoleDB {
  private readonly mongo: Mongo;
  /** collection name */
  private readonly $cn = "roles";
  /**
   * The collection names being accessed
   */
  collections: string[] = [this.$cn];

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
    const collection = db.collection<RoleEntity>(this.$cn);

    return (await collection.find().toArray()).map(omitMongoId);
  }

  /**
   * Gets a specific role by ID
   * @param roleId - The unique identifier for the role
   * @returns Promise resolving to the role data or null if not found
   */
  async getRole(roleId: number): Promise<RoleEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleEntity>(this.$cn);

    const role = await collection.findOne({ id: roleId });

    if (!role) {
      return null;
    }

    return omitMongoId(role);
  }

  /**
   * Inserts or updates a role in the database
   * If the role doesn't have an ID, a new one is generated
   * @param entity - The role data to upsert
   * @returns Promise resolving to the ID of the created or updated role
   * @throws Error if name, description, or prompt are missing
   */
  async upsertRole(entity: RoleEntity): Promise<number> {
    if (!entity.name || !entity.description || !entity.prompt) {
      throw new Error("name, description, and prompt are required");
    }

    entity.updatedAt = Date.now();
    return upsertEntity(this.mongo, this.$cn, entity);
  }

  /**
   * Deletes a role from the database
   * @param id - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteRole(roleId: number): Promise<boolean> {
    return deleteEntity(this.mongo, this.$cn, roleId);
  }
}
