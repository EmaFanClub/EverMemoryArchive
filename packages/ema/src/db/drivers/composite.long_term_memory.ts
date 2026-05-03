import type { EmbeddingConfig } from "../../config";
import { Logger } from "../../shared/logger";
import type {
  CreatedField,
  LongTermMemoryDB,
  LongTermMemoryEntity,
  ListLongTermMemoriesRequest,
  SearchLongTermMemoriesRequest,
  VectorIndexStatus,
} from "../base";
import type { LanceMemoryVectorIndex } from "./lance.long_term_memory";
import type { MongoLongTermMemoryDB } from "./mongo.long_term_memory";

/**
 * Long-term memory facade backed by MongoDB documents and a LanceDB vector index.
 */
export class CompositeLongTermMemoryDB implements LongTermMemoryDB {
  readonly collections: string[];
  private readonly logger = Logger.create({
    name: "long_term_memory",
    outputs: [
      { type: "console", level: "warn" },
      { type: "file", level: "debug" },
    ],
  });

  constructor(
    private readonly store: MongoLongTermMemoryDB,
    private readonly vectorIndex: LanceMemoryVectorIndex,
  ) {
    this.collections = store.collections;
  }

  createIndices(): Promise<void> {
    return this.store.createIndices();
  }

  listLongTermMemories(
    req: ListLongTermMemoriesRequest,
  ): Promise<LongTermMemoryEntity[]> {
    return this.store.listLongTermMemories(req);
  }

  async appendLongTermMemory(entity: LongTermMemoryEntity): Promise<number> {
    const id = await this.store.appendLongTermMemory(entity);
    if (this.vectorIndex.getVectorIndexStatus().state !== "ready") {
      return id;
    }

    try {
      await this.vectorIndex.indexLongTermMemory({ ...entity, id });
    } catch (error) {
      this.logger.warn("Failed to index appended long term memory", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return id;
  }

  deleteLongTermMemory(id: number): Promise<boolean> {
    return this.store.deleteLongTermMemory(id);
  }

  async searchLongTermMemories(
    req: SearchLongTermMemoriesRequest,
  ): Promise<(LongTermMemoryEntity & CreatedField)[]> {
    if (this.vectorIndex.getVectorIndexStatus().state !== "ready") {
      return [];
    }

    try {
      return await this.vectorIndex.searchLongTermMemories(req);
    } catch (error) {
      this.logger.warn("Failed to search long term memory vector index", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async ensureVectorIndex(config: EmbeddingConfig): Promise<VectorIndexStatus> {
    const memories = await this.store.listLongTermMemories({});
    return await this.vectorIndex.ensureVectorIndex(config, memories);
  }

  getVectorIndexStatus(): VectorIndexStatus {
    return this.vectorIndex.getVectorIndexStatus();
  }
}
