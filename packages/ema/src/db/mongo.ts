/**
 * MongoDB interface for database operations.
 * This interface defines the contract for MongoDB client operations.
 */

import type { Db, MongoClient } from "mongodb";

/**
 * Interface for getting all the collection names being accessed
 */
export interface MongoCollectionGetter {
  /**
   * The collection names being accessed
   */
  collections: string[];
}

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
export abstract class Mongo {
  abstract readonly isSnapshotSupported: boolean;

  constructor(protected readonly dbName: string) {}

  /**
   * Gets the MongoDB database instance
   * @returns The MongoDB database instance
   * @throws Error if not connected
   */
  getDb(): Db {
    return this.getClient().db(this.dbName);
  }

  /**
   * Gets the MongoDB client instance
   * @returns The MongoDB client instance
   */
  abstract getClient(): MongoClient;

  /**
   * Gets the MongoDB connection URI.
   * @returns The MongoDB connection URI
   */
  abstract getUri(): string;

  /**
   * Connects to the MongoDB database
   * @returns Promise resolving when connection is established
   */
  abstract connect(): Promise<void>;

  /**
   * Closes the MongoDB connection
   * @returns Promise resolving when connection is closed
   */
  abstract close(): Promise<void>;

  /**
   * Takes a snapshot of the collections and returns the snapshot data.
   * @param collections - The collection names to snapshot
   * @returns The snapshot data
   */
  async snapshot(collections: string[]): Promise<unknown> {
    const client = this.getClient();
    return await client.withSession(async () => {
      const snapshot: Record<string, unknown[]> = {};
      const db = client.db(this.dbName);
      for (const name of collections.sort()) {
        snapshot[name] = await db.collection(name).find().toArray();
      }
      return snapshot;
    });
  }

  /**
   * Restores the MongoDB database from the snapshot data.
   * @param snapshotData - The snapshot data
   * @returns Promise resolving when the restore is complete
   */
  async restoreFromSnapshot(snapshotData: unknown): Promise<void> {
    if (!this.isSnapshotSupported) {
      throw new Error("MongoDB cannot set snapshot.");
    }

    const snapshot = snapshotData as Record<string, any[]>;

    const client = this.getClient();
    return await client.withSession(async () => {
      const db = client.db(this.dbName);
      for (const name of Object.keys(snapshot)) {
        await db.collection(name).deleteMany();
        if (snapshot[name] instanceof Array && snapshot[name].length > 0) {
          await db.collection(name).insertMany(snapshot[name]);
        }
      }
    });
  }
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
