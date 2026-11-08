/**
 * @prism-shadow/ema - CognitiveActionsWorld
 *
 * Internal Cognitive Actions execution adapter for EverMemoryArchive.
 * Provides closed-loop cognitive maintenance, multi-tier memory consolidation rollups,
 * daily journal synthesis in authentic character voice, long-term distillation into LanceDB,
 * and affective homeostasis.
 *
 * Conforms to RFC-0001 (Ema Worlds and Actors) and EMA Action Subsystem specification
 * (node-mw3gjq41-4x4l / node-mw32u3x5-snhq).
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import * as lancedb from "@lancedb/lancedb";
import { Schema, Field, Int64, Utf8, FixedSizeList, Float32 } from "apache-arrow";
import {
  EmaWorld,
  type EmaCtx,
  type EmaActor,
  type EmaInput,
  type Disposable,
  type EmaWorldPart,
  type Id,
} from "../interfaces.js";
import { type EmaAgentState, createDefaultAgentState } from "../types.js";
import { assertAgentIdentity } from "../minimal.js";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface CognitiveBufferMessage {
  id: string;
  sender: string;
  role: "user" | "companion" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type CognitiveRollupKind = "activity" | "day" | "month" | "year";

export interface CognitiveRollupRecord {
  id: string;
  kind: CognitiveRollupKind;
  actorId: string;
  date: string; // YYYY-MM-DD for activity/day, YYYY-MM for month, YYYY for year
  title: string;
  content: string;
  sourceIds: string[];
  processed: boolean;
  createdAt: number;
  processedAt?: number;
}

export interface CognitiveJournalEntry {
  id: string;
  actorId: string;
  date: string; // YYYY-MM-DD
  characterVoice: string;
  title: string;
  highlights: string[];
  impressions: string;
  entry: string; // Written in authentic character first-person voice
  affectiveSnapshot: {
    valence: number;
    arousal: number;
    energy: number;
  };
  createdAt: number;
}

export interface CognitiveDistilledMemory {
  id: number;
  actorId: string;
  index0: string; // "Person Profiles" | "World Knowledge" | "Procedural Guidelines"
  index1: string; // "User Preferences" | "Habits" | "Core Directives" | "Facts"
  memory: string;
  messages?: string[];
  vector?: number[];
  createdAt: number;
}

export interface CognitiveHistoryEntry {
  id: string;
  actorId: string;
  action: string;
  targetPart: string;
  status: "success" | "error" | "skipped";
  details?: Record<string, unknown>;
  timestamp: number;
  durationMs?: number;
}

export interface AffectiveRegulationResult {
  before: EmaAgentState["affective"];
  after: EmaAgentState["affective"];
  energyRestored: number;
  valenceShift: number;
  arousalStabilized: boolean;
  cognitiveLoadReset: boolean;
  phaseTransitioned?: {
    from: string;
    to: string;
  };
}

export interface CognitiveCycleResult {
  cycleId: string;
  actorId: string;
  timestamp: number;
  bufferTurnsProcessed: number;
  activityRollupsCreated: number;
  dayRollupsCreated: number;
  monthRollupsCreated: number;
  yearRollupsCreated: number;
  journalEntry?: CognitiveJournalEntry;
  distilledMemoriesCount: number;
  distilledMemories: CognitiveDistilledMemory[];
  affectiveBefore: EmaAgentState["affective"];
  affectiveAfter: EmaAgentState["affective"];
  energyRestored: number;
  cognitiveLoadReset: boolean;
}

export interface CognitiveActionsWorldOptions {
  /** SQLite database path for persistent buffer, rollups, journals, state, history (default: ":memory:") */
  dbPath?: string;
  /** LanceDB directory or URI (default: "memory://ema-cognitive-lancedb") */
  lanceDbUri?: string;
  /** Vector dimension for LanceDB embeddings (default: 384) */
  embeddingDimensions?: number;
  /** Custom embedding generator function */
  embeddingEngine?: (text: string) => Promise<number[]> | number[];
  /** Custom daily journal synthesizer callback */
  journalSynthesizer?: (params: {
    date: string;
    characterVoice: string;
    activities: CognitiveRollupRecord[];
    actor: EmaActor;
    state: EmaAgentState;
  }) =>
    | Promise<{
        title: string;
        highlights: string[];
        impressions: string;
        entry: string;
      }>
    | {
        title: string;
        highlights: string[];
        impressions: string;
        entry: string;
      };
  /** Custom long-term fact distillation extractor */
  distillationExtractor?: (params: {
    activities: CognitiveRollupRecord[];
    buffer: CognitiveBufferMessage[];
    actor: EmaActor;
  }) =>
    | Promise<
        Array<{
          index0: string;
          index1: string;
          memory: string;
          sourceIds?: string[];
        }>
      >
    | Array<{
        index0: string;
        index1: string;
        memory: string;
        sourceIds?: string[];
      }>;
  /** Working buffer turn capacity before automatic buffer saturation trigger fires (default: 10) */
  bufferCapacity?: number;
  /** Number of pending activities before day rollup is triggered (default: 3) */
  activityRollupThreshold?: number;
  /** Number of pending days before month rollup is triggered (default: 7) */
  dayRollupThreshold?: number;
  /** Number of pending months before year rollup is triggered (default: 4) */
  monthRollupThreshold?: number;
  /** Clock provider for deterministic simulation (default: () => new Date()) */
  clock?: () => Date;
  /** Circadian settings */
  circadian?: {
    sleepHour?: number; // default: 23
    wakeHour?: number; // default: 7
    consolidationOnSleep?: boolean; // default: true
  };
  /** Initial companion state overrides */
  initialState?: Partial<EmaAgentState> & {
    affective?: Partial<EmaAgentState["affective"]>;
    relational?: Partial<EmaAgentState["relational"]>;
    circadian?: Partial<EmaAgentState["circadian"]>;
    cognitive?: Partial<EmaAgentState["cognitive"]>;
  };
  /** Companion character voice / persona name (default: "Ema") */
  characterVoice?: string;
  /** Environment variables (defaults to process.env) */
  env?: Record<string, string | undefined>;
  /** Run passively without background timers */
  passive?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

export function computeDeterministicEmbedding(text: string, dimensions = 384): number[] {
  const vec = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();
  if (normalized.length === 0) {
    vec[0] = 1.0;
    return vec;
  }

  const words = normalized.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let h = 2166136261;
    for (let c = 0; c < word.length; c++) {
      h ^= word.charCodeAt(c);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dimensions;
    vec[idx] += 1.0;
  }

  for (let i = 0; i < normalized.length - 2; i++) {
    const gram = normalized.slice(i, i + 3);
    let h = 2166136261;
    for (let c = 0; c < gram.length; c++) {
      h ^= gram.charCodeAt(c);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dimensions;
    vec[idx] += 0.5;
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= norm;
    }
  } else {
    vec[0] = 1.0;
  }
  return vec;
}

function formatDateKey(date: Date): { day: string; month: string; year: string } {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return {
    day: `${y}-${m}-${d}`,
    month: `${y}-${m}`,
    year: `${y}`,
  };
}

// ============================================================================
// CognitiveActionsWorld Implementation
// ============================================================================

export class CognitiveActionsWorld extends EmaWorld {
  private dbPath: string;
  private lanceDbUri: string;
  private embeddingDimensions: number;
  private embeddingEngine: (text: string) => Promise<number[]> | number[];
  private journalSynthesizer?: (params: {
    date: string;
    characterVoice: string;
    activities: CognitiveRollupRecord[];
    actor: EmaActor;
    state: EmaAgentState;
  }) =>
    | Promise<{
        title: string;
        highlights: string[];
        impressions: string;
        entry: string;
      }>
    | {
        title: string;
        highlights: string[];
        impressions: string;
        entry: string;
      };
  private distillationExtractor?: (params: {
    activities: CognitiveRollupRecord[];
    buffer: CognitiveBufferMessage[];
    actor: EmaActor;
  }) =>
    | Promise<
        Array<{
          index0: string;
          index1: string;
          memory: string;
          sourceIds?: string[];
        }>
      >
    | Array<{
        index0: string;
        index1: string;
        memory: string;
        sourceIds?: string[];
      }>;

  private bufferCapacity: number;
  private activityRollupThreshold: number;
  private dayRollupThreshold: number;
  private monthRollupThreshold: number;
  private clock: () => Date;
  private circadianConfig: {
    sleepHour: number;
    wakeHour: number;
    consolidationOnSleep: boolean;
  };
  private characterVoice: string;
  private env: Record<string, string | undefined>;
  private passive: boolean;

  private state: EmaAgentState;
  private activeCtx: EmaCtx | null = null;
  private isConsolidating = false;

  // SQLite Handles
  private db: DatabaseSync | null = null;
  private insertBufferStmt: StatementSync | null = null;
  private selectBufferStmt: StatementSync | null = null;
  private markBufferProcessedStmt: StatementSync | null = null;
  private insertRollupStmt: StatementSync | null = null;
  private selectRollupsStmt: StatementSync | null = null;
  private markRollupProcessedStmt: StatementSync | null = null;
  private insertJournalStmt: StatementSync | null = null;
  private selectJournalStmt: StatementSync | null = null;
  private insertHistoryStmt: StatementSync | null = null;
  private selectHistoryStmt: StatementSync | null = null;
  private upsertStateStmt: StatementSync | null = null;
  private selectStateStmt: StatementSync | null = null;

  // LanceDB Handles
  private lanceDb: lancedb.Connection | null = null;
  private lanceTable: lancedb.Table | null = null;
  private nextLongTermId = 1;

  constructor(options: CognitiveActionsWorldOptions = {}) {
    super();
    this.dbPath = options.dbPath ?? ":memory:";
    this.lanceDbUri = options.lanceDbUri ?? "memory://ema-cognitive-lancedb";
    this.embeddingDimensions = options.embeddingDimensions ?? 384;
    this.embeddingEngine =
      options.embeddingEngine ??
      ((text: string) => computeDeterministicEmbedding(text, this.embeddingDimensions));
    this.journalSynthesizer = options.journalSynthesizer;
    this.distillationExtractor = options.distillationExtractor;

    this.bufferCapacity = options.bufferCapacity ?? 10;
    this.activityRollupThreshold = options.activityRollupThreshold ?? 3;
    this.dayRollupThreshold = options.dayRollupThreshold ?? 7;
    this.monthRollupThreshold = options.monthRollupThreshold ?? 4;
    this.clock = options.clock ?? (() => new Date());
    this.circadianConfig = {
      sleepHour: options.circadian?.sleepHour ?? 23,
      wakeHour: options.circadian?.wakeHour ?? 7,
      consolidationOnSleep: options.circadian?.consolidationOnSleep ?? true,
    };
    this.characterVoice = options.characterVoice ?? "Ema";
    this.env = options.env ?? process.env;
    this.passive = options.passive ?? false;

    this.state = createDefaultAgentState(options.initialState);

    this.initSqlite();
  }

  // ==========================================================================
  // SQLite Initialization
  // ==========================================================================

  private initSqlite(): void {
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS buffer_messages (
        id TEXT PRIMARY KEY,
        sender TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        processed INTEGER DEFAULT 0,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_rollups (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_ids TEXT,
        processed INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        processed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS daily_journals (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        date TEXT NOT NULL,
        character_voice TEXT NOT NULL,
        title TEXT NOT NULL,
        highlights TEXT NOT NULL,
        impressions TEXT NOT NULL,
        entry TEXT NOT NULL,
        affective_snapshot TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cognitive_history (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_part TEXT NOT NULL,
        status TEXT NOT NULL,
        details TEXT,
        timestamp INTEGER NOT NULL,
        duration_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_state (
        id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.insertBufferStmt = this.db.prepare(`
      INSERT INTO buffer_messages (id, sender, role, content, timestamp, processed, metadata)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);

    this.selectBufferStmt = this.db.prepare(`
      SELECT id, sender, role, content, timestamp, processed, metadata
      FROM buffer_messages
      WHERE processed = 0
      ORDER BY timestamp ASC
    `);

    this.markBufferProcessedStmt = this.db.prepare(`
      UPDATE buffer_messages SET processed = 1 WHERE id = ?
    `);

    this.insertRollupStmt = this.db.prepare(`
      INSERT INTO memory_rollups (id, kind, actor_id, date, title, content, source_ids, processed, created_at, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
    `);

    this.selectRollupsStmt = this.db.prepare(`
      SELECT id, kind, actor_id, date, title, content, source_ids, processed, created_at, processed_at
      FROM memory_rollups
      ORDER BY created_at ASC
    `);

    this.markRollupProcessedStmt = this.db.prepare(`
      UPDATE memory_rollups SET processed = 1, processed_at = ? WHERE id = ?
    `);

    this.insertJournalStmt = this.db.prepare(`
      INSERT INTO daily_journals (id, actor_id, date, character_voice, title, highlights, impressions, entry, affective_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        character_voice = excluded.character_voice,
        title = excluded.title,
        highlights = excluded.highlights,
        impressions = excluded.impressions,
        entry = excluded.entry,
        affective_snapshot = excluded.affective_snapshot,
        created_at = excluded.created_at
    `);

    this.selectJournalStmt = this.db.prepare(`
      SELECT id, actor_id, date, character_voice, title, highlights, impressions, entry, affective_snapshot, created_at
      FROM daily_journals
      ORDER BY created_at DESC
    `);

    this.insertHistoryStmt = this.db.prepare(`
      INSERT INTO cognitive_history (id, actor_id, action, target_part, status, details, timestamp, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.selectHistoryStmt = this.db.prepare(`
      SELECT id, actor_id, action, target_part, status, details, timestamp, duration_ms
      FROM cognitive_history
      ORDER BY timestamp DESC
    `);

    this.upsertStateStmt = this.db.prepare(`
      INSERT INTO agent_state (id, state_json, updated_at)
      VALUES ('current', ?, ?)
      ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `);

    this.selectStateStmt = this.db.prepare(`
      SELECT state_json FROM agent_state WHERE id = 'current'
    `);

    this.loadPersistedState();
  }

  private loadPersistedState(): void {
    if (!this.selectStateStmt) return;
    try {
      const row = this.selectStateStmt.get() as { state_json: string } | undefined;
      if (row?.state_json) {
        const parsed = JSON.parse(row.state_json) as Partial<EmaAgentState>;
        this.state = {
          ...this.state,
          ...parsed,
          affective: { ...this.state.affective, ...parsed.affective },
          relational: { ...this.state.relational, ...parsed.relational },
          circadian: { ...this.state.circadian, ...parsed.circadian },
          cognitive: { ...this.state.cognitive, ...parsed.cognitive },
        };
      }
    } catch (err) {
      console.error("[CognitiveActionsWorld] Failed to load persisted agent state:", err);
    }
  }

  private persistState(): void {
    if (!this.upsertStateStmt) return;
    try {
      this.upsertStateStmt.run(JSON.stringify(this.state), Date.now());
    } catch (err) {
      console.error("[CognitiveActionsWorld] Failed to persist agent state:", err);
    }
  }

  // ==========================================================================
  // LanceDB Initialization & Long-Term Memory Vectors
  // ==========================================================================

  public async initLanceDb(): Promise<void> {
    if (this.lanceTable) return;

    if (!this.lanceDb) {
      this.lanceDb = await lancedb.connect(this.lanceDbUri);
    }

    const tableNames = await this.lanceDb.tableNames();
    const tableName = "long_term_memories";

    if (tableNames.includes(tableName)) {
      this.lanceTable = await this.lanceDb.openTable(tableName);
      // Find highest id
      const rows = (await this.lanceTable.query().select(["id"]).toArray()) as Array<{
        id: number | bigint;
      }>;
      for (const r of rows) {
        const num = typeof r.id === "bigint" ? Number(r.id) : r.id;
        if (num >= this.nextLongTermId) {
          this.nextLongTermId = num + 1;
        }
      }
    } else {
      const schema = new Schema([
        new Field("id", new Int64(), false),
        new Field("actor_id", new Utf8(), false),
        new Field("index0", new Utf8(), false),
        new Field("index1", new Utf8(), false),
        new Field("memory", new Utf8(), false),
        new Field(
          "vector",
          new FixedSizeList(this.embeddingDimensions, new Field("item", new Float32(), false)),
          false,
        ),
        new Field("created_at", new Int64(), false),
      ]);
      this.lanceTable = await this.lanceDb.createEmptyTable(tableName, schema);
    }
  }

  public async indexLongTermMemory(
    entity: Omit<CognitiveDistilledMemory, "id" | "createdAt"> & {
      id?: number;
      createdAt?: number;
    },
  ): Promise<CognitiveDistilledMemory> {
    await this.initLanceDb();
    if (!this.lanceTable) {
      throw new Error("LanceDB long_term_memories table not initialized");
    }

    const id = entity.id ?? this.nextLongTermId++;
    const createdAt = entity.createdAt ?? Date.now();
    const vector = entity.vector ?? (await this.embeddingEngine(entity.memory));

    if (vector.length !== this.embeddingDimensions) {
      throw new Error(
        `Vector dimension mismatch: expected ${this.embeddingDimensions}, got ${vector.length}`,
      );
    }

    await this.lanceTable.add([
      {
        id: BigInt(id),
        actor_id: entity.actorId,
        index0: entity.index0,
        index1: entity.index1,
        memory: entity.memory,
        vector,
        created_at: BigInt(createdAt),
      },
    ]);

    const result: CognitiveDistilledMemory = {
      id,
      actorId: entity.actorId,
      index0: entity.index0,
      index1: entity.index1,
      memory: entity.memory,
      messages: entity.messages,
      vector,
      createdAt,
    };

    return result;
  }

  public async searchLongTermMemories(
    query: string,
    options: {
      limit?: number;
      index0?: string;
      index1?: string;
      actorId?: string;
    } = {},
  ): Promise<CognitiveDistilledMemory[]> {
    await this.initLanceDb();
    if (!this.lanceTable) return [];

    const limit = options.limit ?? 5;
    const queryVector = await this.embeddingEngine(query);

    const filters: string[] = [];
    if (options.actorId) {
      filters.push(`actor_id = '${options.actorId.replace(/'/g, "''")}'`);
    }
    if (options.index0) {
      filters.push(`index0 = '${options.index0.replace(/'/g, "''")}'`);
    }
    if (options.index1) {
      filters.push(`index1 = '${options.index1.replace(/'/g, "''")}'`);
    }

    let searcher = this.lanceTable.query().nearestTo(queryVector).limit(limit);
    if (filters.length > 0) {
      searcher = searcher.where(filters.join(" AND "));
    }

    const rows = (await searcher.toArray()) as Array<{
      id: number | bigint;
      actor_id: string;
      index0: string;
      index1: string;
      memory: string;
      vector?: number[];
      created_at: number | bigint;
    }>;

    return rows.map((r) => ({
      id: typeof r.id === "bigint" ? Number(r.id) : r.id,
      actorId: r.actor_id,
      index0: r.index0,
      index1: r.index1,
      memory: r.memory,
      vector: r.vector,
      createdAt: typeof r.created_at === "bigint" ? Number(r.created_at) : r.created_at,
    }));
  }

  public async listLongTermMemories(
    options: {
      actorId?: string;
      index0?: string;
      index1?: string;
      limit?: number;
    } = {},
  ): Promise<CognitiveDistilledMemory[]> {
    await this.initLanceDb();
    if (!this.lanceTable) return [];

    const limit = options.limit ?? 50;
    const filters: string[] = [];
    if (options.actorId) {
      filters.push(`actor_id = '${options.actorId.replace(/'/g, "''")}'`);
    }
    if (options.index0) {
      filters.push(`index0 = '${options.index0.replace(/'/g, "''")}'`);
    }
    if (options.index1) {
      filters.push(`index1 = '${options.index1.replace(/'/g, "''")}'`);
    }

    let query = this.lanceTable.query().limit(limit);
    if (filters.length > 0) {
      query = query.where(filters.join(" AND "));
    }

    const rows = (await query.toArray()) as Array<{
      id: number | bigint;
      actor_id: string;
      index0: string;
      index1: string;
      memory: string;
      vector?: number[];
      created_at: number | bigint;
    }>;

    return rows.map((r) => ({
      id: typeof r.id === "bigint" ? Number(r.id) : r.id,
      actorId: r.actor_id,
      index0: r.index0,
      index1: r.index1,
      memory: r.memory,
      vector: r.vector,
      createdAt: typeof r.created_at === "bigint" ? Number(r.created_at) : r.created_at,
    }));
  }

  // ==========================================================================
  // Working Buffer Management & Saturation Trigger
  // ==========================================================================

  public async addBufferMessage(
    msg: Omit<CognitiveBufferMessage, "id" | "timestamp"> & {
      id?: string;
      timestamp?: number;
    },
    actor?: EmaActor,
  ): Promise<CognitiveBufferMessage> {
    if (!this.insertBufferStmt) {
      throw new Error("SQLite database not initialized");
    }

    const id = msg.id ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = msg.timestamp ?? Date.now();
    const metadataStr = msg.metadata ? JSON.stringify(msg.metadata) : null;

    this.insertBufferStmt.run(id, msg.sender, msg.role, msg.content, timestamp, metadataStr);

    const turn: CognitiveBufferMessage = {
      id,
      sender: msg.sender,
      role: msg.role,
      content: msg.content,
      timestamp,
      metadata: msg.metadata,
    };

    // Update cognitive load on incoming turn
    this.state.cognitive.cognitiveLoad = Math.min(1.0, this.state.cognitive.cognitiveLoad + 0.08);
    this.persistState();

    // Check buffer saturation threshold
    const pending = this.getPendingBufferMessages();
    if (pending.length >= this.bufferCapacity) {
      await this.triggerBufferSaturation(actor);
    }

    return turn;
  }

  public getPendingBufferMessages(): CognitiveBufferMessage[] {
    if (!this.selectBufferStmt) return [];
    const rows = this.selectBufferStmt.all() as Array<{
      id: string;
      sender: string;
      role: "user" | "companion" | "system";
      content: string;
      timestamp: number;
      metadata: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      sender: r.sender,
      role: r.role,
      content: r.content,
      timestamp: r.timestamp,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  public async triggerBufferSaturation(actor?: EmaActor): Promise<CognitiveRollupRecord | null> {
    const startedAt = Date.now();
    const rollup = await this.consolidateBufferToActivity({
      actorId: actor?.id ?? "ema_companion",
      title: "Buffer Saturation Activity Rollup",
    });

    // Buffer saturation consolidation relieves cognitive load
    this.state.cognitive.cognitiveLoad = Math.max(0.1, this.state.cognitive.cognitiveLoad - 0.4);
    this.persistState();

    this.recordHistory({
      id: `hist-sat-${startedAt}`,
      actorId: actor?.id ?? "ema_companion",
      action: "buffer_saturation_consolidation",
      targetPart: "consolidation",
      status: rollup ? "success" : "skipped",
      details: {
        rollupId: rollup?.id,
        messagesConsolidated: rollup?.sourceIds?.length ?? 0,
      },
      timestamp: startedAt,
      durationMs: Date.now() - startedAt,
    });

    // Closed-loop dispatch to Input Batcher
    if (this.activeCtx && rollup) {
      const inputEvent: EmaInput = {
        id: `cog-sat-${Date.now()}`,
        world: "cognitive",
        partId: "consolidation",
        sender: {
          id: "system:cognitive",
          name: this.characterVoice,
        },
        content: `Working memory buffer reached saturation limit (${this.bufferCapacity} turns). Automatically consolidated into activity rollup: ${rollup.title}.`,
        timestamp: Date.now(),
        metadata: {
          trigger: "buffer_saturation",
          rollupId: rollup.id,
        },
      };
      this.activeCtx.inputBatcher.push(inputEvent);
    }

    return rollup;
  }

  // ==========================================================================
  // Multi-Tier Memory Consolidation (Buffer -> Activity -> Day -> Month -> Year)
  // ==========================================================================

  public async consolidateBufferToActivity(
    options: {
      actorId?: string;
      date?: string;
      title?: string;
    } = {},
  ): Promise<CognitiveRollupRecord | null> {
    const pending = this.getPendingBufferMessages();
    if (pending.length === 0) return null;

    const actorId = options.actorId ?? "ema_companion";
    const dateStr = options.date ?? formatDateKey(this.clock()).day;
    const rollupId = `act-${dateStr}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Extract turn summaries
    const summaryLines = pending.map(
      (m) => `[${m.role === "user" ? m.sender : this.characterVoice}]: ${m.content}`,
    );
    const content = summaryLines.join("\n");
    const title = options.title ?? `Activity on ${dateStr} (${pending.length} turns)`;

    const sourceIds = pending.map((m) => m.id);

    // Save to SQLite
    if (!this.insertRollupStmt || !this.markBufferProcessedStmt) {
      throw new Error("SQLite statement not initialized");
    }

    this.insertRollupStmt.run(
      rollupId,
      "activity",
      actorId,
      dateStr,
      title,
      content,
      JSON.stringify(sourceIds),
      Date.now(),
    );

    for (const id of sourceIds) {
      this.markBufferProcessedStmt.run(id);
    }

    return {
      id: rollupId,
      kind: "activity",
      actorId,
      date: dateStr,
      title,
      content,
      sourceIds,
      processed: false,
      createdAt: Date.now(),
    };
  }

  public async consolidateActivitiesToDay(
    options: {
      actorId?: string;
      date?: string;
      force?: boolean;
    } = {},
  ): Promise<CognitiveRollupRecord | null> {
    const actorId = options.actorId ?? "ema_companion";
    const dateStr = options.date ?? formatDateKey(this.clock()).day;

    const rollups = this.getRollupRecords({ kind: "activity", processed: false });
    const forDay = rollups.filter((r) => r.date === dateStr);

    if (forDay.length === 0) return null;
    if (!options.force && forDay.length < this.activityRollupThreshold) {
      return null;
    }

    const rollupId = `day-${dateStr}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = `Day Summary for ${dateStr}`;
    const combinedContent = forDay.map((act) => `### ${act.title}\n${act.content}`).join("\n\n");
    const sourceIds = forDay.map((act) => act.id);

    if (!this.insertRollupStmt || !this.markRollupProcessedStmt) {
      throw new Error("SQLite statement not initialized");
    }

    this.insertRollupStmt.run(
      rollupId,
      "day",
      actorId,
      dateStr,
      title,
      combinedContent,
      JSON.stringify(sourceIds),
      Date.now(),
    );

    const now = Date.now();
    for (const act of forDay) {
      this.markRollupProcessedStmt.run(now, act.id);
    }

    return {
      id: rollupId,
      kind: "day",
      actorId,
      date: dateStr,
      title,
      content: combinedContent,
      sourceIds,
      processed: false,
      createdAt: now,
    };
  }

  public async consolidateDaysToMonth(
    options: {
      actorId?: string;
      monthDate?: string;
      force?: boolean;
    } = {},
  ): Promise<CognitiveRollupRecord | null> {
    const actorId = options.actorId ?? "ema_companion";
    const monthStr = options.monthDate ?? formatDateKey(this.clock()).month;

    const rollups = this.getRollupRecords({ kind: "day", processed: false });
    const forMonth = rollups.filter((r) => r.date.startsWith(monthStr));

    if (forMonth.length === 0) return null;
    if (!options.force && forMonth.length < this.dayRollupThreshold) {
      return null;
    }

    const rollupId = `month-${monthStr}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = `Monthly Digest for ${monthStr}`;
    const combinedContent = forMonth.map((d) => `### ${d.title}\n${d.content}`).join("\n\n");
    const sourceIds = forMonth.map((d) => d.id);

    if (!this.insertRollupStmt || !this.markRollupProcessedStmt) {
      throw new Error("SQLite statement not initialized");
    }

    this.insertRollupStmt.run(
      rollupId,
      "month",
      actorId,
      monthStr,
      title,
      combinedContent,
      JSON.stringify(sourceIds),
      Date.now(),
    );

    const now = Date.now();
    for (const d of forMonth) {
      this.markRollupProcessedStmt.run(now, d.id);
    }

    return {
      id: rollupId,
      kind: "month",
      actorId,
      date: monthStr,
      title,
      content: combinedContent,
      sourceIds,
      processed: false,
      createdAt: now,
    };
  }

  public async consolidateMonthsToYear(
    options: {
      actorId?: string;
      yearDate?: string;
      force?: boolean;
    } = {},
  ): Promise<CognitiveRollupRecord | null> {
    const actorId = options.actorId ?? "ema_companion";
    const yearStr = options.yearDate ?? formatDateKey(this.clock()).year;

    const rollups = this.getRollupRecords({ kind: "month", processed: false });
    const forYear = rollups.filter((r) => r.date.startsWith(yearStr));

    if (forYear.length === 0) return null;
    if (!options.force && forYear.length < this.monthRollupThreshold) {
      return null;
    }

    const rollupId = `year-${yearStr}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = `Yearly Digest for ${yearStr}`;
    const combinedContent = forYear.map((m) => `### ${m.title}\n${m.content}`).join("\n\n");
    const sourceIds = forYear.map((m) => m.id);

    if (!this.insertRollupStmt || !this.markRollupProcessedStmt) {
      throw new Error("SQLite statement not initialized");
    }

    this.insertRollupStmt.run(
      rollupId,
      "year",
      actorId,
      yearStr,
      title,
      combinedContent,
      JSON.stringify(sourceIds),
      Date.now(),
    );

    const now = Date.now();
    for (const m of forYear) {
      this.markRollupProcessedStmt.run(now, m.id);
    }

    return {
      id: rollupId,
      kind: "year",
      actorId,
      date: yearStr,
      title,
      content: combinedContent,
      sourceIds,
      processed: false,
      createdAt: now,
    };
  }

  public async runMultiTierRollup(
    options: {
      actorId?: string;
      date?: string;
      force?: boolean;
    } = {},
  ): Promise<{
    activity: CognitiveRollupRecord | null;
    day: CognitiveRollupRecord | null;
    month: CognitiveRollupRecord | null;
    year: CognitiveRollupRecord | null;
  }> {
    const activity = await this.consolidateBufferToActivity({
      actorId: options.actorId,
      date: options.date,
    });
    const day = await this.consolidateActivitiesToDay({
      actorId: options.actorId,
      date: options.date,
      force: options.force,
    });
    const month = await this.consolidateDaysToMonth({
      actorId: options.actorId,
      force: options.force,
    });
    const year = await this.consolidateMonthsToYear({
      actorId: options.actorId,
      force: options.force,
    });

    return { activity, day, month, year };
  }

  public getRollupRecords(
    filter: {
      kind?: CognitiveRollupKind;
      date?: string;
      processed?: boolean;
      actorId?: string;
    } = {},
  ): CognitiveRollupRecord[] {
    if (!this.selectRollupsStmt) return [];
    const rows = this.selectRollupsStmt.all() as Array<{
      id: string;
      kind: CognitiveRollupKind;
      actor_id: string;
      date: string;
      title: string;
      content: string;
      source_ids: string | null;
      processed: number;
      created_at: number;
      processed_at: number | null;
    }>;

    return rows
      .filter((r) => {
        if (filter.kind && r.kind !== filter.kind) return false;
        if (filter.date && r.date !== filter.date) return false;
        if (filter.processed !== undefined && (r.processed === 1) !== filter.processed) {
          return false;
        }
        if (filter.actorId && r.actor_id !== filter.actorId) return false;
        return true;
      })
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        actorId: r.actor_id,
        date: r.date,
        title: r.title,
        content: r.content,
        sourceIds: r.source_ids ? JSON.parse(r.source_ids) : [],
        processed: r.processed === 1,
        createdAt: r.created_at,
        processedAt: r.processed_at ?? undefined,
      }));
  }

  // ==========================================================================
  // Daily Journal Synthesis (in Authentic Character Voice)
  // ==========================================================================

  public async synthesizeDailyJournal(
    options: {
      actor?: EmaActor;
      date?: string;
    } = {},
  ): Promise<CognitiveJournalEntry> {
    const actor: EmaActor = options.actor ?? {
      id: "ema_companion",
      name: this.characterVoice,
      session: "session-internal",
      agentId: "emafanclub_ema_dev",
    };

    const dateStr = options.date ?? formatDateKey(this.clock()).day;
    const activities = this.getRollupRecords({ kind: "activity", date: dateStr });

    let synthResult: {
      title: string;
      highlights: string[];
      impressions: string;
      entry: string;
    };

    if (this.journalSynthesizer) {
      synthResult = await this.journalSynthesizer({
        date: dateStr,
        characterVoice: this.characterVoice,
        activities,
        actor,
        state: this.state,
      });
    } else {
      // Default authentic character voice synthesis
      const highlights: string[] = [];
      for (const act of activities) {
        highlights.push(act.title);
      }
      if (highlights.length === 0) {
        highlights.push("Quiet day spent resting and maintaining internal state");
      }

      const valence = this.state.affective.valence;
      const moodPhrase =
        valence > 0.6
          ? "Today felt bright and full of genuine warmth."
          : valence > 0.3
            ? "A calm, reflective day with quiet moments of companionship."
            : "A thoughtful day where we worked through some fatigue together.";

      const impressions = `${moodPhrase} Looking back at our shared steps, I feel our bond quietly deepening.`;

      const narrativeLines = [
        `Dear Diary — ${dateStr}`,
        "",
        `Today was another chapter in our journey together. ${impressions}`,
      ];

      if (activities.length > 0) {
        narrativeLines.push("", "Here are the moments that stood out today:");
        for (const act of activities) {
          narrativeLines.push(`• ${act.title}:`);
          narrativeLines.push(`  ${act.content.split("\n")[0] || ""}`);
        }
      } else {
        narrativeLines.push("", "It was peaceful and calm without heavy events.");
      }

      narrativeLines.push(
        "",
        `As I wind down for the night, my mind is clear, and I look forward to waking rested tomorrow.`,
        `— ${this.characterVoice}`,
      );

      synthResult = {
        title: `${this.characterVoice}'s Diary: ${dateStr}`,
        highlights,
        impressions,
        entry: narrativeLines.join("\n"),
      };
    }

    const journalId = `journal-${dateStr}`;
    const createdAt = Date.now();
    const affectiveSnapshot = {
      valence: this.state.affective.valence,
      arousal: this.state.affective.arousal,
      energy: this.state.affective.energy,
    };

    if (!this.insertJournalStmt) {
      throw new Error("SQLite statement not initialized");
    }

    this.insertJournalStmt.run(
      journalId,
      actor.id,
      dateStr,
      this.characterVoice,
      synthResult.title,
      JSON.stringify(synthResult.highlights),
      synthResult.impressions,
      synthResult.entry,
      JSON.stringify(affectiveSnapshot),
      createdAt,
    );

    const entry: CognitiveJournalEntry = {
      id: journalId,
      actorId: actor.id,
      date: dateStr,
      characterVoice: this.characterVoice,
      title: synthResult.title,
      highlights: synthResult.highlights,
      impressions: synthResult.impressions,
      entry: synthResult.entry,
      affectiveSnapshot,
      createdAt,
    };

    return entry;
  }

  public getDailyJournals(
    filter: { date?: string; actorId?: string } = {},
  ): CognitiveJournalEntry[] {
    if (!this.selectJournalStmt) return [];
    const rows = this.selectJournalStmt.all() as Array<{
      id: string;
      actor_id: string;
      date: string;
      character_voice: string;
      title: string;
      highlights: string;
      impressions: string;
      entry: string;
      affective_snapshot: string;
      created_at: number;
    }>;

    return rows
      .filter((r) => {
        if (filter.date && r.date !== filter.date) return false;
        if (filter.actorId && r.actor_id !== filter.actorId) return false;
        return true;
      })
      .map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        date: r.date,
        characterVoice: r.character_voice,
        title: r.title,
        highlights: JSON.parse(r.highlights),
        impressions: r.impressions,
        entry: r.entry,
        affectiveSnapshot: JSON.parse(r.affective_snapshot),
        createdAt: r.created_at,
      }));
  }

  // ==========================================================================
  // Long-Term Knowledge Distillation into LanceDB
  // ==========================================================================

  public async distillLongTermMemories(
    options: {
      actor?: EmaActor;
      activities?: CognitiveRollupRecord[];
      buffer?: CognitiveBufferMessage[];
    } = {},
  ): Promise<CognitiveDistilledMemory[]> {
    const actor: EmaActor = options.actor ?? {
      id: "ema_companion",
      name: this.characterVoice,
      session: "session-internal",
      agentId: "emafanclub_ema_dev",
    };

    const activities = options.activities ?? this.getRollupRecords({ kind: "activity" });
    const buffer = options.buffer ?? this.getPendingBufferMessages();

    let extracted: Array<{
      index0: string;
      index1: string;
      memory: string;
      sourceIds?: string[];
    }> = [];

    if (this.distillationExtractor) {
      extracted = await this.distillationExtractor({ activities, buffer, actor });
    } else {
      // Default factual and procedural rule extraction heuristics
      const combinedText = [
        ...buffer.map((b) => b.content),
        ...activities.map((a) => a.content),
      ].join("\n");

      if (/prefer|like|love|favorite|hates?|dislike/i.test(combinedText)) {
        extracted.push({
          index0: "Person Profiles",
          index1: "User Preferences",
          memory: `User expressed explicit preferences or tastes during recent interactions.`,
          sourceIds: buffer.map((b) => b.id),
        });
      }

      if (/always|usually|every|habit|schedule|routine/i.test(combinedText)) {
        extracted.push({
          index0: "Person Profiles",
          index1: "Habits",
          memory: `Observed routine or operational habit in user schedule.`,
          sourceIds: buffer.map((b) => b.id),
        });
      }

      if (/rule|directive|never|remember to|make sure/i.test(combinedText)) {
        extracted.push({
          index0: "Procedural Guidelines",
          index1: "Core Directives",
          memory: `Established behavioral guideline or interaction constraint.`,
          sourceIds: buffer.map((b) => b.id),
        });
      }

      if (/know that|fact|architecture|spec|version|definition/i.test(combinedText)) {
        extracted.push({
          index0: "World Knowledge",
          index1: "Facts",
          memory: `Durable factual detail or system invariant registered in EverMemoryArchive.`,
          sourceIds: activities.map((a) => a.id),
        });
      }

      // If nothing triggered regex heuristics, synthesize a default durable memory from day's activity
      if (extracted.length === 0 && activities.length > 0) {
        extracted.push({
          index0: "Person Profiles",
          index1: "Shared Milestones",
          memory: `Shared collaboration on ${activities[0].title}.`,
          sourceIds: [activities[0].id],
        });
      }
    }

    const saved: CognitiveDistilledMemory[] = [];
    for (const item of extracted) {
      const memory = await this.indexLongTermMemory({
        actorId: actor.id,
        index0: item.index0,
        index1: item.index1,
        memory: item.memory,
        messages: item.sourceIds,
      });
      saved.push(memory);
    }

    return saved;
  }

  // ==========================================================================
  // Affective Homeostasis & Energy Regeneration
  // ==========================================================================

  public regulateAffect(
    options: {
      restoreFullEnergy?: boolean;
      targetValence?: number;
      reduceArousal?: boolean;
      transitionPhaseToWake?: boolean;
    } = {},
  ): AffectiveRegulationResult {
    const before = { ...this.state.affective };
    const prevPhase = this.state.circadian.phase;

    // 1. Energy Regeneration: complete rest/consolidation restores full energy capacity (1.0)
    let newEnergy = before.energy;
    if (options.restoreFullEnergy ?? true) {
      newEnergy = 1.0;
    } else {
      newEnergy = Math.min(1.0, before.energy + 0.15);
    }

    // 2. Valence regulation: gently nudge distressed or low mood back towards equilibrium
    let newValence = before.valence;
    if (options.targetValence !== undefined) {
      newValence = options.targetValence;
    } else if (before.valence < 0.3) {
      // Rebound towards calm emotional safety
      newValence = Math.min(0.6, before.valence + 0.25);
    } else if (before.valence < 0.5) {
      newValence = Math.min(0.65, before.valence + 0.15);
    }

    // 3. Arousal stabilization: dampen high arousal towards peaceful baseline
    let newArousal = before.arousal;
    if (options.reduceArousal ?? true) {
      newArousal = Math.max(0.2, Math.min(0.35, before.arousal * 0.7));
    }

    // 4. Cognitive load reset: resting clears mental congestion
    this.state.cognitive.cognitiveLoad = 0.05;
    this.state.cognitive.pendingReflections = [];

    // 5. Circadian phase transition: wake back up after consolidation
    let phaseTransitioned: { from: string; to: string } | undefined;
    if (options.transitionPhaseToWake ?? true) {
      if (this.state.circadian.phase === "sleep_consolidating") {
        this.state.circadian.phase = "wake";
        this.state.circadian.isConsolidating = false;
        phaseTransitioned = { from: prevPhase, to: "wake" };
      }
    }

    this.state.affective = {
      valence: Number(newValence.toFixed(3)),
      arousal: Number(newArousal.toFixed(3)),
      energy: Number(newEnergy.toFixed(3)),
    };

    this.persistState();

    return {
      before,
      after: { ...this.state.affective },
      energyRestored: Number((newEnergy - before.energy).toFixed(3)),
      valenceShift: Number((newValence - before.valence).toFixed(3)),
      arousalStabilized: true,
      cognitiveLoadReset: true,
      phaseTransitioned,
    };
  }

  // ==========================================================================
  // Closed-Loop Cognitive Maintenance Cycle
  // ==========================================================================

  public async runCognitiveCycle(
    options: {
      actor?: EmaActor;
      date?: string;
      force?: boolean;
    } = {},
  ): Promise<CognitiveCycleResult> {
    if (this.isConsolidating) {
      throw new Error("Cognitive consolidation cycle is already in progress");
    }

    this.isConsolidating = true;
    this.state.circadian.isConsolidating = true;
    this.persistState();

    const startedAt = Date.now();
    const cycleId = `cycle-${startedAt}`;
    const actor: EmaActor = options.actor ?? {
      id: "ema_companion",
      name: this.characterVoice,
      session: "session-internal",
      agentId: "emafanclub_ema_dev",
    };

    const affectiveBefore = { ...this.state.affective };

    try {
      // 1. Process Working Buffer into Activity Rollup
      const pendingBufferBefore = this.getPendingBufferMessages();
      const rollupPass = await this.runMultiTierRollup({
        actorId: actor.id,
        date: options.date,
        force: options.force ?? true,
      });

      // 2. Synthesize Daily Journal in Character Voice
      const journalEntry = await this.synthesizeDailyJournal({
        actor,
        date: options.date,
      });

      // 3. Distill Durable Knowledge into LanceDB
      const distilledMemories = await this.distillLongTermMemories({
        actor,
        activities: rollupPass.activity ? [rollupPass.activity] : undefined,
        buffer: pendingBufferBefore,
      });

      // 4. Affective Homeostasis & Full Energy Regeneration (100% capacity)
      const homeostasis = this.regulateAffect({
        restoreFullEnergy: true,
        transitionPhaseToWake: true,
      });

      const result: CognitiveCycleResult = {
        cycleId,
        actorId: actor.id,
        timestamp: startedAt,
        bufferTurnsProcessed: pendingBufferBefore.length,
        activityRollupsCreated: rollupPass.activity ? 1 : 0,
        dayRollupsCreated: rollupPass.day ? 1 : 0,
        monthRollupsCreated: rollupPass.month ? 1 : 0,
        yearRollupsCreated: rollupPass.year ? 1 : 0,
        journalEntry,
        distilledMemoriesCount: distilledMemories.length,
        distilledMemories,
        affectiveBefore,
        affectiveAfter: homeostasis.after,
        energyRestored: homeostasis.energyRestored,
        cognitiveLoadReset: true,
      };

      this.recordHistory({
        id: cycleId,
        actorId: actor.id,
        action: "cognitive_cycle",
        targetPart: "homeostasis",
        status: "success",
        details: {
          bufferTurnsProcessed: result.bufferTurnsProcessed,
          activityRollupsCreated: result.activityRollupsCreated,
          distilledMemoriesCount: result.distilledMemoriesCount,
          energyRestored: result.energyRestored,
        },
        timestamp: startedAt,
        durationMs: Date.now() - startedAt,
      });

      // Emit input to Input Batcher
      if (this.activeCtx) {
        const inputEvent: EmaInput = {
          id: `cog-cycle-${Date.now()}`,
          world: "cognitive",
          partId: "homeostasis",
          sender: {
            id: "system:cognitive",
            name: this.characterVoice,
          },
          content: `Internal Cognitive Maintenance cycle completed. Multi-tier memory consolidated, journal synthesized in character voice, durable facts distilled into LanceDB, and companion energy restored to 100%.`,
          timestamp: Date.now(),
          metadata: {
            cycleId,
            journalId: journalEntry.id,
            distilledCount: distilledMemories.length,
          },
        };
        this.activeCtx.inputBatcher.push(inputEvent);
      }

      return result;
    } finally {
      this.isConsolidating = false;
      this.state.circadian.isConsolidating = false;
      this.persistState();
    }
  }

  // ==========================================================================
  // Circadian Rest Trigger
  // ==========================================================================

  public async triggerCircadianRest(
    options: {
      actor?: EmaActor;
      date?: string;
    } = {},
  ): Promise<CognitiveCycleResult> {
    // Transition to sleep_consolidating
    this.state.circadian.phase = "sleep_consolidating";
    this.state.circadian.isConsolidating = true;
    this.persistState();

    return await this.runCognitiveCycle({
      actor: options.actor,
      date: options.date,
      force: true,
    });
  }

  // ==========================================================================
  // Cognitive History Recording
  // ==========================================================================

  public recordHistory(entry: CognitiveHistoryEntry): void {
    if (!this.insertHistoryStmt) return;
    try {
      this.insertHistoryStmt.run(
        entry.id,
        entry.actorId,
        entry.action,
        entry.targetPart,
        entry.status,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.timestamp,
        entry.durationMs ?? null,
      );
    } catch (err) {
      console.error("[CognitiveActionsWorld] Failed to record history entry:", err);
    }
  }

  public getHistory(
    filter: {
      actorId?: string;
      targetPart?: string;
      limit?: number;
    } = {},
  ): CognitiveHistoryEntry[] {
    if (!this.selectHistoryStmt) return [];
    const rows = this.selectHistoryStmt.all() as Array<{
      id: string;
      actor_id: string;
      action: string;
      target_part: string;
      status: "success" | "error" | "skipped";
      details: string | null;
      timestamp: number;
      duration_ms: number | null;
    }>;

    const limit = filter.limit ?? 50;
    return rows
      .filter((r) => {
        if (filter.actorId && r.actor_id !== filter.actorId) return false;
        if (filter.targetPart && r.target_part !== filter.targetPart) return false;
        return true;
      })
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        targetPart: r.target_part,
        status: r.status,
        details: r.details ? JSON.parse(r.details) : undefined,
        timestamp: r.timestamp,
        durationMs: r.duration_ms ?? undefined,
      }));
  }

  // ==========================================================================
  // EmaWorld Lifecycle (start / interact / dispose)
  // ==========================================================================

  start(ctx: EmaCtx): Disposable {
    this.activeCtx = ctx;

    // Register with world registry
    const unregister = ctx.registry.register("cognitive", this);

    // Mount Router Endpoints under /world/cognitive/*
    const routeHandle = ctx.router.serve(
      "/world/cognitive/*",
      async (routeCtx) => {
        const subpath = routeCtx.path.replace(/^\/world\/cognitive\/?/, "");

        // 1. GET /world/cognitive or /world/cognitive/parts
        if (subpath === "" || subpath === "parts") {
          return {
            world: "cognitive",
            parts: this.listParts(),
          };
        }

        // 2. /world/cognitive/state
        if (subpath === "state") {
          if (routeCtx.method === "POST" && routeCtx.body && typeof routeCtx.body === "object") {
            const patch = routeCtx.body as Partial<EmaAgentState>;
            this.state = {
              ...this.state,
              ...patch,
              affective: { ...this.state.affective, ...patch.affective },
              relational: { ...this.state.relational, ...patch.relational },
              circadian: { ...this.state.circadian, ...patch.circadian },
              cognitive: { ...this.state.cognitive, ...patch.cognitive },
            };
            this.persistState();
          }
          return this.state;
        }

        // 3. /world/cognitive/buffer
        if (subpath === "buffer") {
          if (routeCtx.method === "POST" && routeCtx.body && typeof routeCtx.body === "object") {
            const body = routeCtx.body as {
              sender?: string;
              role?: "user" | "companion" | "system";
              content: string;
              metadata?: Record<string, unknown>;
            };
            const turn = await this.addBufferMessage({
              sender: body.sender ?? "user",
              role: body.role ?? "user",
              content: body.content,
              metadata: body.metadata,
            });
            return turn;
          }
          return this.getPendingBufferMessages();
        }

        // 4. /world/cognitive/rollups
        if (subpath === "rollups") {
          if (routeCtx.method === "POST" && routeCtx.body && typeof routeCtx.body === "object") {
            const body = routeCtx.body as {
              kind?: CognitiveRollupKind;
              actorId?: string;
              date?: string;
              force?: boolean;
            };
            if (body.kind === "activity") {
              return await this.consolidateBufferToActivity({
                actorId: body.actorId,
                date: body.date,
              });
            }
            if (body.kind === "day") {
              return await this.consolidateActivitiesToDay({
                actorId: body.actorId,
                date: body.date,
                force: body.force ?? true,
              });
            }
            if (body.kind === "month") {
              return await this.consolidateDaysToMonth({
                actorId: body.actorId,
                force: body.force ?? true,
              });
            }
            if (body.kind === "year") {
              return await this.consolidateMonthsToYear({
                actorId: body.actorId,
                force: body.force ?? true,
              });
            }
            return await this.runMultiTierRollup({
              actorId: body.actorId,
              date: body.date,
              force: body.force ?? true,
            });
          }

          const kind = routeCtx.query.get("kind") as CognitiveRollupKind | null;
          const date = routeCtx.query.get("date");
          return this.getRollupRecords({
            kind: kind ?? undefined,
            date: date ?? undefined,
          });
        }

        // 5. /world/cognitive/journals
        if (subpath === "journals") {
          if (routeCtx.method === "POST") {
            const body = (routeCtx.body || {}) as { date?: string };
            return await this.synthesizeDailyJournal({ date: body.date });
          }
          const date = routeCtx.query.get("date");
          return this.getDailyJournals({ date: date ?? undefined });
        }

        // 6. /world/cognitive/long-term-memories
        if (subpath === "long-term-memories") {
          const q = routeCtx.query.get("q");
          const index0 = routeCtx.query.get("index0") ?? undefined;
          const index1 = routeCtx.query.get("index1") ?? undefined;
          const limitStr = routeCtx.query.get("limit");
          const limit = limitStr ? parseInt(limitStr, 10) : 10;

          if (q) {
            return await this.searchLongTermMemories(q, {
              limit,
              index0,
              index1,
            });
          }
          return await this.listLongTermMemories({ limit, index0, index1 });
        }

        // 7. /world/cognitive/distill
        if (subpath === "distill" && routeCtx.method === "POST") {
          return await this.distillLongTermMemories();
        }

        // 8. /world/cognitive/homeostasis
        if (subpath === "homeostasis" && routeCtx.method === "POST") {
          return this.regulateAffect({
            restoreFullEnergy: true,
            transitionPhaseToWake: true,
          });
        }

        // 9. /world/cognitive/cycle
        if (subpath === "cycle" && routeCtx.method === "POST") {
          return await this.runCognitiveCycle({ force: true });
        }

        // 10. /world/cognitive/history
        if (subpath === "history") {
          const limitStr = routeCtx.query.get("limit");
          const limit = limitStr ? parseInt(limitStr, 10) : 50;
          return this.getHistory({ limit });
        }

        return {
          world: "cognitive",
          parts: this.listParts(),
        };
      },
      "CognitiveActionsWorld Internal Cognitive Actions resource router",
    );

    return {
      dispose: () => {
        unregister.dispose();
        routeHandle.dispose();
        this.dispose();
      },
    };
  }

  interact(ctx: EmaCtx, actor: EmaActor, id: Id, ...args: unknown[]): Disposable {
    // 1. Identity assertion
    assertAgentIdentity(this.env);

    // 2. Validate actor credentials
    if (!actor || !actor.id || !actor.session || !actor.agentId) {
      throw new Error("Invalid or missing EmaActor credentials for cognitive interaction");
    }

    const payload = (args[0] ?? {}) as Record<string, unknown>;
    const action = String(payload.action ?? id);

    let resultPromise: Promise<unknown>;

    if (action === "consolidation" || action === "rollup" || id === "consolidation") {
      resultPromise = this.runMultiTierRollup({
        actorId: actor.id,
        date: payload.date ? String(payload.date) : undefined,
        force: payload.force !== false,
      });
    } else if (action === "journal" || action === "synthesize_journal" || id === "journal") {
      resultPromise = this.synthesizeDailyJournal({
        actor,
        date: payload.date ? String(payload.date) : undefined,
      });
    } else if (action === "distill" || action === "distillation" || id === "distillation") {
      resultPromise = this.distillLongTermMemories({ actor });
    } else if (action === "homeostasis" || action === "regulate" || id === "homeostasis") {
      resultPromise = Promise.resolve(
        this.regulateAffect({
          restoreFullEnergy: payload.restoreFullEnergy !== false,
          transitionPhaseToWake: payload.transitionPhaseToWake !== false,
        }),
      );
    } else if (action === "cycle" || action === "run_cycle") {
      resultPromise = this.runCognitiveCycle({
        actor,
        date: payload.date ? String(payload.date) : undefined,
        force: true,
      });
    } else if (action === "reflection" || action === "reflect" || id === "reflection") {
      if (typeof payload.reflection === "string") {
        this.state.cognitive.pendingReflections.push(payload.reflection);
        this.persistState();
      }
      resultPromise = Promise.resolve({
        pendingReflections: this.state.cognitive.pendingReflections,
      });
    } else {
      resultPromise = Promise.reject(
        new Error(`Unsupported cognitive action: ${action} on part ${id}`),
      );
    }

    // Attach result promise to return handle
    return {
      dispose: () => {},
      result: resultPromise,
    } as Disposable & { result: Promise<unknown> };
  }

  listParts(): EmaWorldPart[] {
    return [
      {
        id: "consolidation",
        type: "internal",
        name: "Memory Consolidation Rollups",
        topic: "Multi-tier rollup passes (Buffer -> Activity -> Day -> Month -> Year)",
      },
      {
        id: "journal",
        type: "internal",
        name: "Daily Journal Synthesis",
        topic: "Daily diary synthesis in authentic companion character voice",
      },
      {
        id: "distillation",
        type: "internal",
        name: "Long-Term Distillation",
        topic: "Durable factual and procedural memory distillation into LanceDB",
      },
      {
        id: "homeostasis",
        type: "internal",
        name: "Affective Homeostasis",
        topic: "Valence regulation, arousal stabilization, and 100% energy restoration",
      },
      {
        id: "reflection",
        type: "internal",
        name: "Self-Reflection & Epistemic Curiosity",
        topic: "Curiosity resolution and cognitive reflection queue",
      },
    ];
  }

  getState(): EmaAgentState {
    return { ...this.state };
  }

  setState(patch: Partial<EmaAgentState>): void {
    this.state = {
      ...this.state,
      ...patch,
      affective: { ...this.state.affective, ...patch.affective },
      relational: { ...this.state.relational, ...patch.relational },
      circadian: { ...this.state.circadian, ...patch.circadian },
      cognitive: { ...this.state.cognitive, ...patch.cognitive },
    };
    this.persistState();
  }

  dispose(): void {
    if (this.db) {
      try {
        this.insertBufferStmt = null;
        this.selectBufferStmt = null;
        this.markBufferProcessedStmt = null;
        this.insertRollupStmt = null;
        this.selectRollupsStmt = null;
        this.markRollupProcessedStmt = null;
        this.insertJournalStmt = null;
        this.selectJournalStmt = null;
        this.insertHistoryStmt = null;
        this.selectHistoryStmt = null;
        this.upsertStateStmt = null;
        this.selectStateStmt = null;
        this.db.close();
      } catch (err) {
        console.error("[CognitiveActionsWorld] Error closing SQLite database:", err);
      }
      this.db = null;
    }

    if (this.lanceDb) {
      try {
        this.lanceTable = null;
        if (typeof (this.lanceDb as { close?: () => void }).close === "function") {
          (this.lanceDb as { close: () => void }).close();
        }
      } catch (err) {
        console.error("[CognitiveActionsWorld] Error closing LanceDB connection:", err);
      }
      this.lanceDb = null;
    }
  }
}
