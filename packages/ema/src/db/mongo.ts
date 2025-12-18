/**
 * MongoDB interface for database operations.
 * This interface defines the contract for MongoDB client operations.
 */

import type { Db, MongoClient } from "mongodb";

/**
 * Arguments for creating a MongoDB instance
 */
export interface CreateMongoArgs {
  /**
   * MongoDB connection string
   * @default "mongodb://localhost:27017"
   */
  uri?: string;
  /**
   * MongoDB database name
   * @default "ema"
   */
  dbName?: string;
}

/**
 * MongoDB provider interface
 */
export interface MongoProvider {
  /**
   * Creates a new MongoDB instance
   * @param args - Arguments for creating a MongoDB instance
   * @returns The MongoDB instance
   */
  new (args: CreateMongoArgs): Mongo;
}

/**
 * A mongo database instance
 */
export interface Mongo {
  /**
   * Gets the MongoDB database instance
   * @returns The MongoDB database instance
   */
  getDb(): Db;

  /**
   * Gets the MongoDB client instance
   * @returns The MongoDB client instance
   */
  getClient(): MongoClient;

  /**
   * Connects to the MongoDB database
   * @returns Promise resolving when connection is established
   */
  connect(): Promise<void>;

  /**
   * Closes the MongoDB connection
   * @returns Promise resolving when connection is closed
   */
  close(): Promise<void>;
}

/**
 * Creates a new MongoDB instance
 * @param uri - MongoDB connection string
 * @param dbName - MongoDB database name
 * @param kind - MongoDB implementation kind
 * @returns Promise resolving to the MongoDB instance
 */
export async function createMongo(
  uri: string,
  dbName: string,
  kind: "memory" | "remote",
): Promise<Mongo> {
  const impl: MongoProvider =
    kind === "memory"
      ? (await import("./mongo/memory")).MemoryMongo
      : (await import("./mongo/remote")).RemoteMongo;
  return new impl({ uri, dbName });
}

import type { RoleDB, RoleData } from "./base";

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
   * @returns Promise resolving to the next role ID as a string
   */
  private async getNextId(kind: string): Promise<number> {
    const db = this.mongo.getDb();
    const counters = db.collection<CounterDocument>(this.counterCollectionName);

    const result = await counters.findOneAndUpdate(
      { _id: kind },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );

    return result?.seq ?? 0;
  }

  /**
   * Lists all roles in the database
   * Excludes soft-deleted roles (those with deleteTime set)
   * @returns Promise resolving to an array of role data
   */
  async listRoles(): Promise<RoleData[]> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleData>(this.collectionName);

    const roles = await collection
      .find({ deleteTime: { $exists: false } })
      .toArray();

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

    // Return null if role is soft-deleted
    if (role.deleteTime) {
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
   * Soft deletes a role by setting its deleteTime
   * @param roleId - The unique identifier for the role to delete
   * @returns Promise resolving to true if deleted, false if not found
   */
  async deleteRole(roleId: number): Promise<boolean> {
    const db = this.mongo.getDb();
    const collection = db.collection<RoleData>(this.collectionName);

    // Check if role exists and is not already deleted
    const role = await collection.findOne({ id: roleId });

    if (!role || role.deleteTime) {
      return false;
    }

    // Soft delete: set deleteTime instead of removing the role
    await collection.updateOne(
      { id: roleId },
      { $set: { deleteTime: Date.now() } },
    );

    return true;
  }
}
