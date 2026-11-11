/**
 * @prism-shadow/ema - Cold Archive SQLite Store & Cognitive State Persistence (RFC-0006 / RFC-0007)
 *
 * Manages:
 * - Persistent SQLite cold memory archive (`archiveRef`) for raw compacted turns (`cold_archive_scenes`, `cold_archive_items`)
 * - Atomic loading and saving of `CompanionCognitiveState` (`ema-state.json`)
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CompanionCognitiveState,
  CompanionPersonality,
  MemoryItem,
} from "../cognition/types.js";
import {
  createDefaultCompressionPrompt,
  createInitialPersonalityTemplate,
} from "../cognition/persona-mutator.js";

export interface ColdArchiveEntry {
  archiveId: string;
  sceneId: string;
  title: string;
  setting: string;
  archivedAt: string;
  items: MemoryItem[];
}

function openColdArchiveDb(archiveDbPath: string): DatabaseSync {
  if (archiveDbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(archiveDbPath), { recursive: true });
  }
  const db = new DatabaseSync(archiveDbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS cold_archive_scenes (
      archive_id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      setting TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      items_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cold_archive_items (
      turn_id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      turn_index_in_scene INTEGER NOT NULL,
      input_text TEXT NOT NULL,
      committed_os TEXT NOT NULL,
      action_text TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cold_archive_items_scene_id
      ON cold_archive_items(scene_id, turn_index_in_scene);
  `);
  return db;
}

/**
 * Persists a compacted scene's raw `MemoryItem[]` trajectory into the SQLite cold memory archive
 * and returns a stable logical `archiveRef` pointer (`archive://L0/<sceneId>`).
 */
export function appendColdArchiveRecord(
  archiveDbPath: string,
  entry: Omit<ColdArchiveEntry, "archivedAt">,
): string {
  const archivedAt = new Date().toISOString();
  const db = openColdArchiveDb(archiveDbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const upsertScene = db.prepare(`
        INSERT INTO cold_archive_scenes (
          archive_id, scene_id, title, setting, archived_at, items_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(scene_id) DO UPDATE SET
          archive_id = excluded.archive_id,
          title = excluded.title,
          setting = excluded.setting,
          archived_at = excluded.archived_at,
          items_json = excluded.items_json
      `);
      upsertScene.run(
        entry.archiveId,
        entry.sceneId,
        entry.title,
        entry.setting,
        archivedAt,
        JSON.stringify(entry.items),
      );

      const upsertItem = db.prepare(`
        INSERT OR REPLACE INTO cold_archive_items (
          turn_id, scene_id, turn_index_in_scene, input_text, committed_os, action_text, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of entry.items) {
        upsertItem.run(
          item.turnId,
          entry.sceneId,
          item.turnIndexInScene,
          item.inputText,
          item.committedOS || item.predictedOS || "",
          item.gtActionText || item.predictedAction || "",
          archivedAt,
        );
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
  return `archive://L0/${entry.sceneId}`;
}

/**
 * Reads archived scene trajectories from the SQLite cold memory archive.
 */
export function readColdArchiveRecords(
  archiveDbPath: string,
  sceneIdFilter?: string,
): ColdArchiveEntry[] {
  if (archiveDbPath !== ":memory:" && !fs.existsSync(archiveDbPath)) {
    return [];
  }
  const db = openColdArchiveDb(archiveDbPath);
  try {
    const rows = sceneIdFilter
      ? (db
          .prepare(
            `SELECT archive_id, scene_id, title, setting, archived_at, items_json
             FROM cold_archive_scenes
             WHERE scene_id = ?
             ORDER BY rowid ASC`,
          )
          .all(sceneIdFilter) as Array<{
          archive_id: string;
          scene_id: string;
          title: string;
          setting: string;
          archived_at: string;
          items_json: string;
        }>)
      : (db
          .prepare(
            `SELECT archive_id, scene_id, title, setting, archived_at, items_json
             FROM cold_archive_scenes
             ORDER BY rowid ASC`,
          )
          .all() as Array<{
          archive_id: string;
          scene_id: string;
          title: string;
          setting: string;
          archived_at: string;
          items_json: string;
        }>);

    const entries: ColdArchiveEntry[] = [];
    for (const row of rows) {
      try {
        entries.push({
          archiveId: row.archive_id,
          sceneId: row.scene_id,
          title: row.title,
          setting: row.setting,
          archivedAt: row.archived_at,
          items: JSON.parse(row.items_json) as MemoryItem[],
        });
      } catch {
        // skip malformed entry
      }
    }
    return entries;
  } finally {
    db.close();
  }
}

/**
 * Loads an existing `CompanionCognitiveState` from disk, or initializes a fresh one.
 */
export function loadOrCreateCognitiveState(options: {
  statePath: string;
  agentId: string;
  companionName?: string;
  protagonistName?: string;
  initialPersonality?: CompanionPersonality;
}): CompanionCognitiveState {
  const { statePath, agentId } = options;
  if (fs.existsSync(statePath)) {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as CompanionCognitiveState;
    return {
      schemaVersion: "1.0.0",
      agentId: raw.agentId || agentId,
      protagonistName: raw.protagonistName || options.protagonistName || "Owner",
      personality: raw.personality,
      anchorPersonality: raw.anchorPersonality || structuredClone(raw.personality),
      compressionPrompt:
        raw.compressionPrompt ||
        createDefaultCompressionPrompt(
          raw.personality?.name || options.companionName || agentId,
          raw.protagonistName || options.protagonistName || "Owner",
        ),
      memoryIndex: Array.isArray(raw.memoryIndex) ? raw.memoryIndex : [],
      l1MemoryIndex: Array.isArray(raw.l1MemoryIndex) ? raw.l1MemoryIndex : [],
      sessionTurnCursors:
        raw.sessionTurnCursors && typeof raw.sessionTurnCursors === "object"
          ? raw.sessionTurnCursors
          : {},
      dreamedSceneIds: Array.isArray(raw.dreamedSceneIds) ? raw.dreamedSceneIds : [],
      anchorBenchmarkScenes: Array.isArray(raw.anchorBenchmarkScenes)
        ? raw.anchorBenchmarkScenes
        : undefined,
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }

  const companionName =
    options.initialPersonality?.name || options.companionName || agentId;
  const protagonistName = options.protagonistName || "Owner";
  const personality =
    options.initialPersonality ||
    createInitialPersonalityTemplate({
      name: companionName,
      protagonistName,
    });

  return {
    schemaVersion: "1.0.0",
    agentId,
    protagonistName,
    personality: structuredClone(personality),
    anchorPersonality: structuredClone(personality),
    compressionPrompt: createDefaultCompressionPrompt(companionName, protagonistName),
    memoryIndex: [],
    l1MemoryIndex: [],
    sessionTurnCursors: {},
    dreamedSceneIds: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Atomically saves `CompanionCognitiveState` to disk (write temp + rename).
 */
export function saveCognitiveState(
  statePath: string,
  state: CompanionCognitiveState,
): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, statePath);
}
