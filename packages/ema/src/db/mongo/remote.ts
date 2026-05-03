/**
 * Remote MongoDB implementation for production.
 * Connects to an actual MongoDB instance using connection string.
 */

import { MongoClient } from "mongodb";
import type { CreateMongoArgs } from "./base";
import { Mongo } from "./base";

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
    const queryIndex = this.uri.indexOf("?");
    const beforeQuery =
      queryIndex === -1 ? this.uri : this.uri.slice(0, queryIndex);
    const query = queryIndex === -1 ? "" : this.uri.slice(queryIndex);
    const authorityStart = beforeQuery.indexOf("://");
    if (authorityStart === -1) {
      return this.uri;
    }

    const pathStart = beforeQuery.indexOf("/", authorityStart + 3);
    if (pathStart === -1) {
      return `${beforeQuery}/${this.dbName}${withDefaultAuthSource(
        query,
        beforeQuery,
      )}`;
    }
    if (beforeQuery.slice(pathStart) === "/") {
      return `${beforeQuery.slice(0, pathStart)}/${this.dbName}${withDefaultAuthSource(
        query,
        beforeQuery,
      )}`;
    }
    return this.uri;
  }
}

function withDefaultAuthSource(query: string, beforeQuery: string): string {
  if (!hasCredentials(beforeQuery) || hasAuthSource(query)) {
    return query;
  }
  return query ? `${query}&authSource=admin` : "?authSource=admin";
}

function hasCredentials(beforeQuery: string): boolean {
  const authorityStart = beforeQuery.indexOf("://");
  if (authorityStart === -1) {
    return false;
  }
  const authority = beforeQuery.slice(authorityStart + 3);
  return authority.includes("@");
}

function hasAuthSource(query: string): boolean {
  if (!query) {
    return false;
  }
  return new URLSearchParams(query.slice(1)).has("authSource");
}
