/**
 * @prism-shadow/ema - Dynamic Episodic Boundary Detector (RFC-0006)
 *
 * Replaces static Galgame scene IDs during live companion interaction by slicing
 * a stream of `LiveConversationTurn[]` into episodic windows `w_x` based on:
 * 1. Channel / World context shifts (`channel_shift`)
 * 2. Temporal idle gaps (`idle_gap`)
 * 3. Turn count or character/token watermarks (`turn_watermark` / `token_watermark`)
 * 4. Explicit or end-of-batch session flush (`session_flush`)
 */

import type {
  EpisodicWindowSlice,
  LiveConversationTurn,
  MemoryItem,
  SceneWindow,
  TurnBundle,
} from "../cognition/types.js";

export interface BoundaryDetectorOptions {
  /** Starting order number for newly sliced scenes (1-based) */
  startOrder?: number;
  /** Scene ID prefix, e.g. "live" -> "live_001" */
  scenePrefix?: string;
  /** Chapter label assigned to live episodic windows */
  chapterLabel?: string;
  /** Maximum turns per episodic window before forcing a boundary (default: 8) */
  maxTurnsPerWindow?: number;
  /** Maximum total characters per episodic window before forcing a boundary (default: 3200) */
  maxCharsPerWindow?: number;
  /** Idle time gap in ms between turns that triggers a new episodic scene (default: 30 min) */
  idleGapMs?: number;
  /** Minimum turns required in the trailing buffer to emit a window when flushing (default: 1) */
  minTurnsToFlush?: number;
  /** Whether to flush the trailing partial window at the end of the stream (default: true) */
  flushTrailing?: boolean;
}

/**
 * Slices uncompacted `LiveConversationTurn[]` (after `afterCursor`) into episodic windows.
 */
export function sliceTurnsIntoEpisodicWindows(
  turns: LiveConversationTurn[],
  afterCursor = 0,
  options: BoundaryDetectorOptions = {},
): EpisodicWindowSlice[] {
  const uncompacted = turns.filter((t) => t.turnIndex > afterCursor);
  if (uncompacted.length === 0) return [];

  const maxTurns = Math.max(1, options.maxTurnsPerWindow ?? 8);
  const maxChars = Math.max(200, options.maxCharsPerWindow ?? 3200);
  const idleGapMs = Math.max(10_000, options.idleGapMs ?? 30 * 60 * 1000);
  const minTurnsToFlush = Math.max(1, options.minTurnsToFlush ?? 1);
  const flushTrailing = options.flushTrailing ?? true;
  const prefix = options.scenePrefix || "live";
  const chapter = options.chapterLabel || "日常相伴";

  let nextOrder = options.startOrder ?? 1;
  const windows: EpisodicWindowSlice[] = [];

  let currentTurns: LiveConversationTurn[] = [];
  let currentChars = 0;

  const emitWindow = (
    reason: EpisodicWindowSlice["boundaryReason"],
    sliceTurns: LiveConversationTurn[],
  ) => {
    if (sliceTurns.length === 0) return;
    const order = nextOrder++;
    const first = sliceTurns[0];
    const last = sliceTurns[sliceTurns.length - 1];
    const dateTag = (first.timestamp || new Date().toISOString()).slice(0, 10);
    const channelLabel =
      first.channel.startsWith("qq:group:")
        ? `QQ群聊 (${first.channel.replace("qq:group:", "")})`
        : first.channel === "direct"
          ? "专属伴侣空间"
          : first.channel;

    const rawTopicSource = first.inputText
      .replace(/<[^>]+>/g, " ")
      .replace(/\[RFC-0002[^\]]*\]:?/gi, " ")
      .replace(/^\[[^\]]+\]:\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    const previewTopic = (
      rawTopicSource && !rawTopicSource.startsWith("聊天室频道")
        ? rawTopicSource
        : first.actionText.replace(/\s+/g, " ").trim()
    ).slice(0, 18);

    const sceneId = `${prefix}_${String(order).padStart(3, "0")}`;
    const title = previewTopic ? `${previewTopic}…` : `相伴片段 #${order}`;
    const setting = `${dateTag} · ${channelLabel}`;

    windows.push({
      sceneId,
      order,
      chapter,
      title,
      setting,
      boundaryReason: reason,
      startTurnIndex: first.turnIndex,
      endTurnIndex: last.turnIndex,
      turns: sliceTurns,
    });
  };

  for (let i = 0; i < uncompacted.length; i++) {
    const turn = uncompacted[i];
    const turnChars =
      (turn.inputText?.length || 0) +
      (turn.latentOS?.length || 0) +
      (turn.actionText?.length || 0);

    if (currentTurns.length > 0) {
      const prev = currentTurns[currentTurns.length - 1];

      // 1. Check channel/world context shift
      if (prev.channel !== turn.channel) {
        emitWindow("channel_shift", currentTurns);
        currentTurns = [];
        currentChars = 0;
      } else {
        // 2. Check temporal idle gap
        const prevTs = Date.parse(prev.timestamp);
        const currTs = Date.parse(turn.timestamp);
        if (!Number.isNaN(prevTs) && !Number.isNaN(currTs) && currTs - prevTs >= idleGapMs) {
          emitWindow("idle_gap", currentTurns);
          currentTurns = [];
          currentChars = 0;
        } else if (currentTurns.length >= maxTurns) {
          // 3. Check turn count watermark
          emitWindow("turn_watermark", currentTurns);
          currentTurns = [];
          currentChars = 0;
        } else if (currentChars + turnChars > maxChars) {
          // 4. Check character/token watermark
          emitWindow("token_watermark", currentTurns);
          currentTurns = [];
          currentChars = 0;
        }
      }
    }

    currentTurns.push(turn);
    currentChars += turnChars;
  }

  if (flushTrailing && currentTurns.length >= minTurnsToFlush) {
    emitWindow("session_flush", currentTurns);
  }

  return windows;
}

/**
 * Converts a live `EpisodicWindowSlice` into a `SceneWindow` and `MemoryItem[]`
 * compatible with `compactSceneMemory` and `EmaDreamEngine`.
 */
export function convertSliceToSceneAndMemoryItems(
  slice: EpisodicWindowSlice,
  targetCharacter: string,
): {
  scene: SceneWindow;
  items: MemoryItem[];
} {
  const turns: TurnBundle[] = [];
  const items: MemoryItem[] = [];
  const speakers = new Set<string>([targetCharacter]);

  for (let i = 0; i < slice.turns.length; i++) {
    const lt = slice.turns[i];
    speakers.add(lt.sender || "Owner");
    const turnId = `${slice.sceneId}#turn-${String(i + 1).padStart(2, "0")}`;
    const formattedInput = lt.inputText.startsWith("[")
      ? lt.inputText
      : `【${lt.sender || "Owner"}】: ${lt.inputText}`;

    turns.push({
      id: turnId,
      sceneId: slice.sceneId,
      turnIndexInScene: i + 1,
      globalTurnIndex: lt.turnIndex,
      inputLines: [
        {
          index: i * 2,
          global_index: lt.turnIndex * 2,
          type: "dialogue",
          speaker: lt.sender || "Owner",
          text: lt.inputText,
          raw: formattedInput,
        },
      ],
      inputText: formattedInput,
      gtActionLines: [
        {
          index: i * 2 + 1,
          global_index: lt.turnIndex * 2 + 1,
          type: "dialogue",
          speaker: targetCharacter,
          text: lt.actionText,
          raw: lt.actionText,
        },
      ],
      gtActionText: lt.actionText,
      explicitOS: lt.latentOS || null,
    });

    items.push({
      turnId,
      sceneId: slice.sceneId,
      turnIndexInScene: i + 1,
      inputText: formattedInput,
      predictedOS: lt.latentOS,
      committedOS: lt.latentOS,
      predictedAction: lt.actionText,
      gtActionText: lt.actionText,
      osConsistent: true,
      osScore: 85,
      actionScore: 85,
      combinedScore: 85,
      diagnostic: "Live conversation turn committed from Route Session",
    });
  }

  const scene: SceneWindow = {
    sceneId: slice.sceneId,
    order: slice.order,
    chapter: slice.chapter,
    title: slice.title,
    setting: slice.setting,
    isHScene: false,
    characters: [...speakers],
    rawLineCount: slice.turns.length * 2,
    turns,
    trailingLines: [],
    trailingText: "",
  };

  return { scene, items };
}
