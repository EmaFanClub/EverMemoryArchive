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
  if (!["memory", "remote"].includes(kind)) {
    throw new Error(`Invalid kind: ${kind}. Must be "memory" or "remote".`);
  }

  const impl: MongoProvider =
    kind === "memory"
      ? (await import("./mongo/memory")).MemoryMongo
      : (await import("./mongo/remote")).RemoteMongo;
  return new impl({ uri, dbName });
}
