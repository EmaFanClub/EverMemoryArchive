import type {
  SearchLongTermMemoriesRequest,
  LongTermMemoryEntity,
  VectorIndexStatus,
} from "../base";
import type { Mongo } from "../mongo";
import { MongoMemorySearchAdaptor } from "./mongo.long_term_memory";
import * as lancedb from "@lancedb/lancedb";
import {
  Field,
  Int64,
  FixedSizeList,
  Float32,
  Schema,
  Utf8,
} from "apache-arrow";

import { GlobalConfig, type EmbeddingConfig } from "../../config/index";
import { EmbeddingClient } from "../../memory/embedding_client";
import {
  listEmbeddingModelDefinitions,
  resolveEmbeddingModelConfig,
} from "../../memory/embedding_models";
import { Logger } from "../../shared/logger";

/**
 * The text input used to compute an embedding.
 */
export type LongTermMemoryEmbeddingInput = string;

/**
 * Interface for a long term memory embedding engine
 */
export interface LongTermMemoryEmbeddingEngine {
  /**
   * Creates a vector embedding for a long term memory
   * @param dim - The dimension of the vector embedding
   * @param input - The text input to embed
   * @returns Promise resolving to the vector embedding of the long term memory
   */
  createEmbedding(
    dim: number | undefined,
    input: LongTermMemoryEmbeddingInput,
  ): Promise<number[] | undefined>;
}

/**
 * LanceDB-based implementation of LongTermMemorySearcher
 * Uses vector search to find long term memories
 */
export class LanceMemoryVectorIndex extends MongoMemorySearchAdaptor {
  /** isDebug */
  private readonly isDebug = false;
  /** index table */
  private indexTable: lancedb.Table | null = null;
  private active: {
    tableName: string;
    dimensions: number;
    embeddingEngine: LongTermMemoryEmbeddingEngine;
  } | null = null;
  private status: VectorIndexStatus = {
    state: "not_started",
    activeFingerprint: null,
    activeProvider: null,
    activeModel: null,
  };
  private readonly logger: Logger = Logger.create({
    name: "lancedb.memory",
    outputs: [
      { type: "console", level: "warn" },
      { type: "file", level: "debug" },
    ],
  });

  constructor(
    mongo: Mongo,
    private readonly lancedb: lancedb.Connection,
    private embeddingEngine?: LongTermMemoryEmbeddingEngine,
  ) {
    super(mongo);
  }

  async createIndices(): Promise<void> {
    // Vector table initialization depends on database-backed embedding config,
    // so it is performed by ensureVectorIndex() after GlobalConfig is loaded.
  }

  async doSearch(req: SearchLongTermMemoriesRequest): Promise<number[]> {
    if (!this.indexTable || !this.active || this.status.state !== "ready") {
      throw new Error("Long term memory vector index is not ready.");
    }
    const actorId = req.actorId;
    if (!actorId || typeof actorId !== "number") {
      throw new Error("actorId must be provided");
    }
    if (!req.memory) {
      throw new Error("memory must be provided");
    }
    const embedding = await this.active.embeddingEngine.createEmbedding(
      this.active.dimensions,
      req.memory,
    );
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }

    const filters = [`actor_id = ${actorId}`];
    if (req.index0) {
      filters.push(`index0 = '${escapeWhereValue(req.index0)}'`);
    }
    if (req.index1) {
      filters.push(`index1 = '${escapeWhereValue(req.index1)}'`);
    }
    let query = this.indexTable
      .query()
      .where(filters.join(" AND "))
      .nearestTo(embedding)
      .limit(req.limit);

    let ids: { id: number }[] = this.isDebug
      ? await query.toArray()
      : await query.select(["id", "_distance"]).toArray();
    if (this.isDebug) {
      this.logger.debug("LanceDB memory search result", ids);
    }

    return ids.map((res) =>
      typeof res.id === "bigint" ? Number(res.id) : res.id,
    );
  }

  /**
   * Indexes a long term memory
   * @param entity - The long term memory to index
   * @returns Promise resolving to void
   */
  async indexLongTermMemory(entity: LongTermMemoryEntity): Promise<void> {
    if (!this.indexTable || !this.active || this.status.state !== "ready") {
      return;
    }
    const id = entity.id;
    if (!id) {
      throw new Error("id must be provided");
    }
    const actorId = entity.actorId;
    if (!actorId) {
      throw new Error("actorId must be provided");
    }

    try {
      await this.addMemoryToActiveTable(entity);
      this.status = {
        ...this.status,
        totalMemories: (this.status.totalMemories ?? 0) + 1,
        indexedMemories: (this.status.indexedMemories ?? 0) + 1,
      };
    } catch (error) {
      this.markFailed(error);
      throw error;
    }
  }

  /**
   * Ensures the active vector index table matches the given embedding config.
   */
  async ensureVectorIndex(
    config: EmbeddingConfig,
    memories: LongTermMemoryEntity[],
  ): Promise<VectorIndexStatus> {
    const startedAt = Date.now();
    const runtimeConfig = GlobalConfig.resolveRuntimeEmbeddingConfig(config);
    const summary = embeddingConfigSummary(runtimeConfig);
    let activeTableName: string | null = null;
    let dimensions: number | undefined;
    let indexedMemories = 0;
    this.status = {
      state: "indexing",
      activeFingerprint: null,
      activeProvider: summary.provider,
      activeModel: summary.model,
      startedAt,
      totalMemories: memories.length,
      indexedMemories: 0,
    };

    try {
      const invalidMessage = validateEmbeddingConfig(runtimeConfig);
      if (invalidMessage) {
        throw new Error(invalidMessage);
      }
      const embeddingEngine =
        this.embeddingEngine ?? new EmbeddingClient(config);
      const probe = await embeddingEngine.createEmbedding(
        undefined,
        "EMA embedding probe",
      );
      if (!probe?.length) {
        throw new Error("Embedding provider returned an empty vector.");
      }
      dimensions = probe.length;
      const tableName = createLongTermMemoryTableName(
        summary.model,
        dimensions,
      );
      this.indexTable = await this.openOrCreateTable(tableName, dimensions);
      this.active = {
        tableName,
        dimensions,
        embeddingEngine,
      };
      activeTableName = tableName;

      const indexedIds = await this.listIndexedIds();
      for (const memory of memories) {
        if (typeof memory.id !== "number") {
          this.status = {
            ...this.status,
            activeFingerprint: activeTableName,
            dimensions,
            indexedMemories,
          };
          continue;
        }
        if (indexedIds.has(memory.id)) {
          indexedMemories += 1;
          this.status = {
            ...this.status,
            activeFingerprint: activeTableName,
            dimensions,
            indexedMemories,
          };
          continue;
        }
        await this.addMemoryToActiveTable(memory);
        indexedIds.add(memory.id);
        indexedMemories += 1;
        this.status = {
          ...this.status,
          activeFingerprint: activeTableName,
          dimensions,
          indexedMemories,
        };
      }

      this.status = {
        state: "ready",
        activeFingerprint: tableName,
        activeProvider: summary.provider,
        activeModel: summary.model,
        dimensions,
        startedAt,
        finishedAt: Date.now(),
        totalMemories: memories.length,
        indexedMemories,
      };
    } catch (error) {
      this.indexTable = null;
      this.active = null;
      this.status = {
        state: indexedMemories > 0 ? "degraded" : "failed",
        activeFingerprint: activeTableName,
        activeProvider: summary.provider,
        activeModel: summary.model,
        ...(typeof dimensions === "number" ? { dimensions } : {}),
        startedAt,
        finishedAt: Date.now(),
        totalMemories: memories.length,
        indexedMemories,
        error: errorMessage(error),
      };
    }

    return this.getVectorIndexStatus();
  }

  getVectorIndexStatus(): VectorIndexStatus {
    return { ...this.status };
  }

  async deleteLongTermMemory(id: number): Promise<void> {
    const deletedFromActiveTable = await this.hasActiveTableMemory(id);
    const tableNames = await this.lancedb.tableNames();
    await Promise.all(
      tableNames.filter(isLongTermMemoryTableName).map(async (tableName) => {
        const table =
          this.active?.tableName === tableName && this.indexTable
            ? this.indexTable
            : await this.lancedb.openTable(tableName);
        await table.delete(`id = ${id}`);
      }),
    );
    if (deletedFromActiveTable && this.status.totalMemories !== undefined) {
      this.status = {
        ...this.status,
        totalMemories: Math.max(0, this.status.totalMemories - 1),
        indexedMemories:
          this.status.indexedMemories !== undefined
            ? Math.max(0, this.status.indexedMemories - 1)
            : this.status.indexedMemories,
      };
    }
  }

  async deleteLongTermMemoriesByActorId(actorId: number): Promise<void> {
    if (typeof actorId !== "number") {
      throw new Error("actorId must be a number");
    }
    const deletedFromActiveTable =
      await this.countActiveTableActorMemories(actorId);
    const tableNames = await this.lancedb.tableNames();
    await Promise.all(
      tableNames.filter(isLongTermMemoryTableName).map(async (tableName) => {
        const table =
          this.active?.tableName === tableName && this.indexTable
            ? this.indexTable
            : await this.lancedb.openTable(tableName);
        await table.delete(`actor_id = ${actorId}`);
      }),
    );
    if (deletedFromActiveTable > 0 && this.status.totalMemories !== undefined) {
      this.status = {
        ...this.status,
        totalMemories: Math.max(
          0,
          this.status.totalMemories - deletedFromActiveTable,
        ),
        indexedMemories:
          this.status.indexedMemories !== undefined
            ? Math.max(0, this.status.indexedMemories - deletedFromActiveTable)
            : this.status.indexedMemories,
      };
    }
  }

  private async hasActiveTableMemory(id: number): Promise<boolean> {
    if (!this.indexTable) {
      return false;
    }
    const rows = (await this.indexTable
      .query()
      .where(`id = ${id}`)
      .select(["id"])
      .limit(1)
      .toArray()) as Array<{ id: number | bigint }>;
    return rows.length > 0;
  }

  private async countActiveTableActorMemories(
    actorId: number,
  ): Promise<number> {
    if (!this.indexTable) {
      return 0;
    }
    return await this.indexTable.countRows(`actor_id = ${actorId}`);
  }

  private async openOrCreateTable(
    tableName: string,
    dimensions: number,
  ): Promise<lancedb.Table> {
    const hasThisTable = await this.lancedb
      .tableNames()
      .then((names) => names.includes(tableName));
    if (hasThisTable) {
      return await this.lancedb.openTable(tableName);
    }
    return await this.lancedb.createEmptyTable(
      tableName,
      new Schema([
        new Field("id", new Int64(), false),
        new Field("actor_id", new Int64(), false),
        new Field("index0", new Utf8(), false),
        new Field("index1", new Utf8(), false),
        new Field(
          "embedding",
          new FixedSizeList(
            dimensions,
            new Field("item", new Float32(), false),
          ),
          false,
        ),
      ]),
    );
  }

  private async listIndexedIds(): Promise<Set<number>> {
    if (!this.indexTable) {
      return new Set();
    }
    const rows = (await this.indexTable
      .query()
      .select(["id"])
      .toArray()) as Array<{ id: number | bigint }>;
    return new Set(
      rows.map((row) => (typeof row.id === "bigint" ? Number(row.id) : row.id)),
    );
  }

  private async addMemoryToActiveTable(
    entity: LongTermMemoryEntity,
  ): Promise<void> {
    if (!this.indexTable || !this.active) {
      throw new Error("Long term memory vector index is not ready.");
    }
    const id = entity.id;
    if (!id) {
      throw new Error("id must be provided");
    }
    const actorId = entity.actorId;
    if (!actorId) {
      throw new Error("actorId must be provided");
    }
    const embedding = await this.active.embeddingEngine.createEmbedding(
      this.active.dimensions,
      entity.memory,
    );
    if (!embedding) {
      throw new Error("cannot compute embedding");
    }
    await this.indexTable.add([
      {
        id,
        actor_id: actorId,
        index0: entity.index0,
        index1: entity.index1,
        embedding,
      },
    ]);
  }

  private markFailed(error: unknown): void {
    this.status = {
      ...this.status,
      state: "failed",
      finishedAt: Date.now(),
      error: errorMessage(error),
    };
    this.indexTable = null;
    this.active = null;
  }
}

export function createLongTermMemoryTableName(
  model: string,
  dimensions: number,
): string {
  return `${createSafeEmbeddingTableModelName(model)}_${dimensions}`;
}

export function createSafeEmbeddingTableModelName(model: string): string {
  const name = model
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) {
    throw new Error("Embedding model table name is empty.");
  }
  return name;
}

function embeddingConfigSummary(config: EmbeddingConfig): {
  provider: ReturnType<typeof resolveEmbeddingModelConfig>["provider"];
  model: string;
  baseUrl: string;
  clientType: string;
  dimensions?: number;
} {
  const resolved = resolveEmbeddingModelConfig(config);
  return {
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    clientType: resolved.clientType,
    ...(resolved.dimensions !== undefined
      ? { dimensions: resolved.dimensions }
      : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateEmbeddingConfig(config: EmbeddingConfig): string | null {
  if (!config.model.trim()) {
    return "Embedding config is incomplete.";
  }
  if (!config.baseUrl.trim() || !config.apiKey.trim()) {
    return "Embedding config is incomplete.";
  }
  try {
    resolveEmbeddingModelConfig(config);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

function isLongTermMemoryTableName(tableName: string): boolean {
  return listEmbeddingModelDefinitions().some((definition) => {
    const prefix = `${createSafeEmbeddingTableModelName(definition.model)}_`;
    const dimensionText = tableName.startsWith(prefix)
      ? tableName.slice(prefix.length)
      : "";
    return /^[1-9]\d*$/u.test(dimensionText);
  });
}

function escapeWhereValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
