/**
 * @prism-shadow/ema - Cold Archive & Cognitive State Persistence (RFC-0006 / RFC-0007)
 *
 * Manages:
 * - Cold storage JSONL archiving of raw compacted turns (`archiveRef`)
 * - Atomic loading and saving of `CompanionCognitiveState` (`ema-state.json`)
 */

import fs from "node:fs";
import path from "node:path";
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

/**
 * Appends a compacted scene's raw `MemoryItem[]` trajectory to the cold archive JSONL file
 * and returns a stable `archiveRef` pointer (`<file>#<archiveId>`).
 */
export function appendColdArchiveRecord(
  archiveJsonlPath: string,
  entry: Omit<ColdArchiveEntry, "archivedAt">,
): string {
  fs.mkdirSync(path.dirname(archiveJsonlPath), { recursive: true });
  const record: ColdArchiveEntry = {
    ...entry,
    archivedAt: new Date().toISOString(),
  };
  fs.appendFileSync(archiveJsonlPath, JSON.stringify(record) + "\n", "utf8");
  return `${path.basename(archiveJsonlPath)}#${entry.archiveId}`;
}

/**
 * Reads archived scene trajectories from the cold archive JSONL file.
 */
export function readColdArchiveRecords(archiveJsonlPath: string): ColdArchiveEntry[] {
  if (!fs.existsSync(archiveJsonlPath)) return [];
  const lines = fs
    .readFileSync(archiveJsonlPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const entries: ColdArchiveEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ColdArchiveEntry);
    } catch {
      // skip malformed line
    }
  }
  return entries;
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
