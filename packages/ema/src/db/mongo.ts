/**
 * MongoDB interface for database operations.
 * This interface defines the contract for MongoDB client operations.
 */

import type { Db, MongoClient } from "mongodb";

/**
 * Interface for MongoDB operations
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
