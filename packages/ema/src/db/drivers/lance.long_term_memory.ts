import type {
  SearchLongTermMemoriesRequest,
  LongTermMemoryEntity,
  VectorIndexStatus,
} from "../base";
import type { Mongo } from "../mongo";
import { MongoMemorySearchAdaptor } from "./mongo.long_term_memory";
import * as lancedb from "@lancedb/lancedb";
import { createHash } from "node:crypto";
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
    fingerprint: string;
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
    let activeFingerprint: string | null = null;
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
      const fingerprint = createEmbeddingConfigFingerprint(
        runtimeConfig,
        dimensions,
      );
      const tableName = createLongTermMemoryTableName(fingerprint, dimensions);
      this.indexTable = await this.openOrCreateTable(tableName, dimensions);
      this.active = {
        fingerprint,
        tableName,
        dimensions,
        embeddingEngine,
      };
      activeFingerprint = fingerprint;

      const indexedIds = await this.listIndexedIds();
      for (const memory of memories) {
        if (typeof memory.id !== "number") {
          this.status = {
            ...this.status,
            activeFingerprint,
            dimensions,
            indexedMemories,
          };
          continue;
        }
        if (indexedIds.has(memory.id)) {
          indexedMemories += 1;
          this.status = {
            ...this.status,
            activeFingerprint,
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
          activeFingerprint,
          dimensions,
          indexedMemories,
        };
      }

      this.status = {
        state: "ready",
        activeFingerprint: fingerprint,
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
        activeFingerprint,
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

export function createEmbeddingConfigFingerprint(
  config: EmbeddingConfig,
  dimensions: number,
): string {
  const summary = embeddingConfigSummary(config);
  return createHash("sha256")
    .update(JSON.stringify({ ...summary, dimensions }))
    .digest("hex")
    .slice(0, 16);
}

export function createLongTermMemoryTableName(
  fingerprint: string,
  dimensions: number,
): string {
  return `long_term_memories_${fingerprint}_${dimensions}`;
}

function embeddingConfigSummary(config: EmbeddingConfig): {
  provider: EmbeddingConfig["provider"];
  model: string;
  baseUrl: string;
  useVertexAi?: boolean;
  project?: string;
  location?: string;
} {
  if (config.provider === "openai") {
    return {
      provider: "openai",
      model: config.openai.model,
      baseUrl: config.openai.baseUrl,
    };
  }
  return {
    provider: "google",
    model: config.google.model,
    baseUrl: config.google.useVertexAi ? "vertex-ai" : config.google.baseUrl,
    useVertexAi: config.google.useVertexAi,
    project: config.google.useVertexAi ? config.google.project : "",
    location: config.google.useVertexAi ? config.google.location : "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateEmbeddingConfig(config: EmbeddingConfig): string | null {
  if (config.provider === "openai") {
    return !config.openai.model.trim() ||
      !config.openai.baseUrl.trim() ||
      !config.openai.apiKey.trim()
      ? "Embedding config is incomplete."
      : null;
  }
  if (!config.google.model.trim()) {
    return "Embedding config is incomplete.";
  }
  if (config.google.useVertexAi) {
    return !config.google.project.trim() ||
      !config.google.location.trim() ||
      !config.google.credentialsFile.trim()
      ? "Google Vertex AI project, location, and credentials JSON are required."
      : null;
  }
  return !config.google.baseUrl.trim() || !config.google.apiKey.trim()
    ? "Embedding config is incomplete."
    : null;
}

function escapeWhereValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
