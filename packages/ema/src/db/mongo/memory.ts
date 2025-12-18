/**
 * In-memory MongoDB implementation for development and testing.
 * Uses mongodb-memory-server to provide a MongoDB instance in memory.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import type { CreateMongoArgs, Mongo } from "../mongo";

/**
 * In-memory MongoDB implementation
 * Uses mongodb-memory-server for development and testing environments
 */
export class MemoryMongo implements Mongo {
  private mongoServer?: MongoMemoryServer;
  private client?: MongoClient;
  private db?: Db;
  private readonly dbName: string;

  /**
   * Creates a new MemoryMongo instance
   * @param args - Arguments for creating a MemoryMongo instance
   */
  constructor({ dbName }: CreateMongoArgs) {
    this.dbName = dbName ?? "ema";
  }

  /**
   * Connects to the in-memory MongoDB instance
   * Creates a new MongoMemoryServer if not already started
   * @returns Promise resolving when connection is established
   */
  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    let mongoServer: MongoMemoryServer | undefined;
    let client: MongoClient | undefined;

    try {
      mongoServer = await MongoMemoryServer.create();
      const uri = mongoServer.getUri();
      client = new MongoClient(uri);
      await client.connect();

      this.mongoServer = mongoServer;
      this.client = client;
      this.db = client.db(this.dbName);
    } catch (error) {
      if (client) {
        try {
          await client.close();
        } catch {
          // ignore close errors during cleanup
        }
      }

      if (mongoServer) {
        try {
          await mongoServer.stop();
        } catch {
          // ignore stop errors during cleanup
        }
      }

      this.client = undefined;
      this.db = undefined;
      this.mongoServer = undefined;

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
   * Closes the MongoDB connection and stops the in-memory server
   * @returns Promise resolving when connection is closed and server is stopped
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
      this.db = undefined;
    }
    if (this.mongoServer) {
      await this.mongoServer.stop();
      this.mongoServer = undefined;
    }
  }
}
