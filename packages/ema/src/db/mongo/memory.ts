/**
 * In-memory MongoDB implementation for development and testing.
 * Uses mongodb-memory-server to provide a MongoDB instance in memory.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import type { CreateMongoArgs } from "../mongo";
import { Mongo } from "../mongo";

/**
 * In-memory MongoDB implementation
 * Uses mongodb-memory-server for development and testing environments
 */
export class MemoryMongo extends Mongo {
  readonly isSnapshotSupported: boolean = true;

  private mongoServer?: MongoMemoryServer;
  private client?: MongoClient;

  /**
   * Creates a new MemoryMongo instance
   * @param args - Arguments for creating a MemoryMongo instance
   */
  constructor({ dbName = "ema" }: CreateMongoArgs) {
    super(dbName);
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
      mongoServer = await MongoMemoryServer.create({
        instance: {
          port: 0,
        },
      });
      const uri = mongoServer.getUri();
      client = new MongoClient(uri);
      await client.connect();

      this.mongoServer = mongoServer;
      this.client = client;
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
      this.mongoServer = undefined;

      throw error;
    }
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
   * Gets the MongoDB connection URI.
   * @returns The MongoDB connection URI
   * @throws Error if not connected
   */
  getUri(): string {
    if (!this.mongoServer) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.mongoServer.getUri(this.dbName);
  }

  /**
   * Closes the MongoDB connection and stops the in-memory server
   * @returns Promise resolving when connection is closed and server is stopped
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
    if (this.mongoServer) {
      await this.mongoServer.stop();
      this.mongoServer = undefined;
    }
  }
}
