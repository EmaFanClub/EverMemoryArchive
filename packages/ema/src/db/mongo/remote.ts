/**
 * Remote MongoDB implementation for production.
 * Connects to an actual MongoDB instance using connection string.
 */

import { createRequire } from "node:module";
import { MongoClient } from "mongodb";
import type { CreateMongoArgs } from "../mongo";
import { Mongo } from "../mongo";

type ConnectionString = {
  pathname: string;
  toString(): string;
};

type ConnectionStringConstructor = new (
  uri: string,
  options?: { looseValidation?: boolean },
) => ConnectionString;

const requireFromMongo = createRequire(
  createRequire(import.meta.url).resolve("mongodb/package.json"),
);
const { default: MongoConnectionString } = requireFromMongo(
  "mongodb-connection-string-url",
) as { default: ConnectionStringConstructor };

/**
 * Remote MongoDB implementation
 * Connects to an actual MongoDB instance for production environments
 */
export class RemoteMongo extends Mongo {
  readonly isSnapshotSupported: boolean = false;

  private client?: MongoClient;
  private readonly uri: string;

  /**
   * Creates a new RemoteMongo instance
   * @param uri - MongoDB connection string (default: mongodb://localhost:27017)
   * @param dbName - Name of the database (default: ema)
   */
  constructor({ uri, dbName = "ema" }: CreateMongoArgs) {
    super(dbName);
    this.uri = uri || "mongodb://localhost:27017";
  }

  /**
   * Connects to the MongoDB instance
   * @returns Promise resolving when connection is established
   */
  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = new MongoClient(this.uri);
    try {
      await client.connect();
      this.client = client;
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
   */
  getUri(): string {
    return this.buildUriWithDb();
  }

  /**
   * Closes the MongoDB connection
   * @returns Promise resolving when connection is closed
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
  }

  private buildUriWithDb(): string {
    const connectionString = new MongoConnectionString(this.uri);
    if (connectionString.pathname === "" || connectionString.pathname === "/") {
      connectionString.pathname = `/${this.dbName}`;
    }
    return connectionString.toString();
  }
}
