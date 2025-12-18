/**
 * Remote MongoDB implementation for production.
 * Connects to an actual MongoDB instance using connection string.
 */

import { MongoClient, type Db } from "mongodb";
import type { Mongo } from "../mongo";

/**
 * Remote MongoDB implementation
 * Connects to an actual MongoDB instance for production environments
 */
export class RemoteMongo implements Mongo {
  private client?: MongoClient;
  private db?: Db;
  private readonly uri: string;
  private readonly dbName: string;

  /**
   * Creates a new RemoteMongo instance
   * @param uri - MongoDB connection string (default: mongodb://localhost:27017)
   * @param dbName - Name of the database (default: evermindagent)
   */
  constructor(
    uri: string = "mongodb://localhost:27017",
    dbName: string = "evermindagent",
  ) {
    this.uri = uri;
    this.dbName = dbName;
  }

  /**
   * Connects to the MongoDB instance
   * @returns Promise resolving when connection is established
   */
  async connect(): Promise<void> {
    if (this.client && this.db) {
      return;
    }

    const client = new MongoClient(this.uri);
    try {
      await client.connect();
      this.client = client;
      this.db = client.db(this.dbName);
    } catch (error) {
      try {
        await client.close();
      } catch {
        // Ignore errors during cleanup
      }
      throw error;
    }
  }

  /**
   * Gets the MongoDB database instance
   * @returns The MongoDB database instance
   * @throws Error if not connected
   */
  getDb(): Db {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db;
  }

  /**
   * Gets the MongoDB client instance
   * @returns The MongoDB client instance
   * @throws Error if not connected
   */
  getClient(): MongoClient {
    if (!this.client) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.client;
  }

  /**
   * Closes the MongoDB connection
   * @returns Promise resolving when connection is closed
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.db = undefined;
    }
  }
}
