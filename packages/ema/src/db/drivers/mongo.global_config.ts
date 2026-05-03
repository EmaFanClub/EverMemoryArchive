import type { GlobalConfigDB, GlobalConfigEntity } from "../base";
import type { Mongo } from "../mongo";
import { omitMongoId } from "../mongo/utils";

const GLOBAL_CONFIG_ID = "global";

/**
 * MongoDB-based implementation of GlobalConfigDB.
 * Stores the singleton runtime configuration in the database.
 */
export class MongoGlobalConfigDB implements GlobalConfigDB {
  private readonly $cn = "global_config";

  /** The collection names being accessed. */
  collections: string[] = [this.$cn];

  /**
   * Creates a new MongoGlobalConfigDB instance.
   * @param mongo - MongoDB instance to use for database operations.
   */
  constructor(private readonly mongo: Mongo) {}

  /**
   * Gets the singleton global configuration.
   * @returns Promise resolving to the config or null when setup is incomplete.
   */
  async getGlobalConfig(): Promise<GlobalConfigEntity | null> {
    const db = this.mongo.getDb();
    const collection = db.collection<GlobalConfigEntity>(this.$cn);
    const config = await collection.findOne({ id: GLOBAL_CONFIG_ID });
    return config ? omitMongoId(config) : null;
  }

  /**
   * Inserts or updates the singleton global configuration.
   * @param entity - Complete global configuration to persist.
   */
  async upsertGlobalConfig(entity: GlobalConfigEntity): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<GlobalConfigEntity>(this.$cn);
    const existing = await collection.findOne({ id: GLOBAL_CONFIG_ID });
    const now = Date.now();
    await collection.updateOne(
      { id: GLOBAL_CONFIG_ID },
      {
        $set: {
          ...entity,
          id: GLOBAL_CONFIG_ID,
          version: 1,
          createdAt: existing?.createdAt ?? entity.createdAt ?? now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }

  /** Creates indices for the global_config collection. */
  async createIndices(): Promise<void> {
    const db = this.mongo.getDb();
    const collection = db.collection<GlobalConfigEntity>(this.$cn);
    await collection.createIndex({ id: 1 }, { unique: true });
  }
}
