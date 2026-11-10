/**
 * @prism-shadow/ema - Galgame Script Dataset Washer & Turn-Bundle Builder
 *
 * Transforms cleaned visual novel scripts (e.g. `hoken-sensei.json`) into
 * sequential SceneWindows and TurnBundles D = {q_1, ..., q_T} for Shirobana (白花).
 */

import fs from "node:fs";
import type {
  DatasetWashStats,
  RawGalgameScript,
  RawScriptLine,
  RawScriptScene,
  SceneWindow,
  TurnBundle,
  WashedDataset,
} from "./types.js";

export const SHIROBANA_SPEAKER_ALIASES = new Set([
  "白花",
  "シロバナ",
  "白",
  "小白",
  "百花",
  "苍空＆白花",
]);

/**
 * Checks whether a script line is spoken/thought by Shirobana (白花).
 * Handles scene-specific pre-reveal aliases (`？？？` in `001_シナリオ01_01`).
 */
export function isShirobanaSpeaker(speaker: string | null, sceneId: string): boolean {
  if (!speaker) return false;
  if (SHIROBANA_SPEAKER_ALIASES.has(speaker)) return true;
  if (sceneId === "001_シナリオ01_01" && speaker === "？？？") return true;
  return false;
}

/**
 * Extracts chapter identifier from a scene_id (e.g. "005_シナリオ01_05" -> "シナリオ01").
 */
export function extractChapterFromSceneId(sceneId: string): string {
  const parts = sceneId.split("_");
  if (parts.length >= 2) {
    return parts[1];
  }
  return "unknown";
}

/**
 * Formats a raw script line for inclusion in Input_t context.
 */
export function formatInputLine(line: RawScriptLine): string {
  const text = (line.text || "").trim();
  if (!text) return "";
  if (line.type === "narration" || !line.speaker) {
    return `[旁白] ${text}`;
  }
  if (line.type === "monologue") {
    return `【${line.speaker}】(内心): （${text}）`;
  }
  return `【${line.speaker}】: 「${text}」`;
}

/**
 * Formats Shirobana's consecutive lines into Ground Truth Action_t^*.
 */
export function formatShirobanaActionLines(lines: RawScriptLine[]): {
  gtActionText: string;
  explicitOS: string | null;
} {
  const spokenParts: string[] = [];
  const osParts: string[] = [];

  for (const line of lines) {
    const text = (line.text || "").trim();
    if (!text) continue;
    if (line.type === "monologue") {
      osParts.push(text);
    } else {
      spokenParts.push(`「${text}」`);
    }
  }

  // If a turn was purely a monologue line, treat it as both explicitOS and subtle action
  if (spokenParts.length === 0 && osParts.length > 0) {
    spokenParts.push(`（${osParts.join(" ")}）`);
  }

  return {
    gtActionText: spokenParts.join(" "),
    explicitOS: osParts.length > 0 ? osParts.join(" ") : null,
  };
}

export interface WashDatasetOptions {
  /** Exclude H-scenes (`Hシーン`) from the training sequence; defaults to true */
  excludeHScenes?: boolean;
  /** Maximum story order index (defaults to 201 to exclude engine/voice-preview placeholders) */
  maxOrder?: number;
  /** Optional scene ID filter or slice */
  sceneIds?: string[];
}

/**
 * Washes a parsed RawGalgameScript into SceneWindows and TurnBundles.
 */
export function washGalgameScript(
  script: RawGalgameScript,
  options: WashDatasetOptions = {},
): WashedDataset {
  const excludeHScenes = options.excludeHScenes ?? true;
  const maxOrder = options.maxOrder ?? 201;
  const sceneIdFilter = options.sceneIds ? new Set(options.sceneIds) : null;

  const speakerAliasCounts: Record<string, number> = {};
  let storyScenesWithTarget = 0;
  let nonHScenesWithTarget = 0;
  let hScenesWithTarget = 0;
  let totalRawTargetLines = 0;
  let explicitTargetMonologues = 0;
  let globalTurnIndex = 0;

  const washedScenes: SceneWindow[] = [];

  for (const rawScene of script.scenes) {
    if (rawScene.order > maxOrder) continue;

    const hasTarget = rawScene.lines.some((l) => isShirobanaSpeaker(l.speaker, rawScene.scene_id));
    if (!hasTarget) continue;

    const isHScene = rawScene.scene_id.includes("Hシーン");
    storyScenesWithTarget++;
    if (isHScene) {
      hScenesWithTarget++;
    } else {
      nonHScenesWithTarget++;
    }

    if (excludeHScenes && isHScene) continue;
    if (sceneIdFilter && !sceneIdFilter.has(rawScene.scene_id)) continue;

    const turns: TurnBundle[] = [];
    let pendingInputLines: RawScriptLine[] = [];
    let pendingTargetLines: RawScriptLine[] = [];
    let turnIndexInScene = 0;

    const flushTurn = () => {
      if (pendingTargetLines.length === 0) return;
      turnIndexInScene++;
      globalTurnIndex++;

      const inputText =
        pendingInputLines
          .map(formatInputLine)
          .filter(Boolean)
          .join("\n") || "[场景开场]";

      const { gtActionText, explicitOS } = formatShirobanaActionLines(pendingTargetLines);

      turns.push({
        id: `${rawScene.scene_id}#turn-${String(turnIndexInScene).padStart(2, "0")}`,
        sceneId: rawScene.scene_id,
        turnIndexInScene,
        globalTurnIndex,
        inputLines: [...pendingInputLines],
        inputText,
        gtActionLines: [...pendingTargetLines],
        gtActionText,
        explicitOS,
      });

      pendingInputLines = [];
      pendingTargetLines = [];
    };

    for (const line of rawScene.lines) {
      if (isShirobanaSpeaker(line.speaker, rawScene.scene_id)) {
        const sp = line.speaker || "白花";
        speakerAliasCounts[sp] = (speakerAliasCounts[sp] || 0) + 1;
        totalRawTargetLines++;
        if (line.type === "monologue") {
          explicitTargetMonologues++;
        }
        pendingTargetLines.push(line);
      } else {
        if (pendingTargetLines.length > 0) {
          flushTurn();
        }
        pendingInputLines.push(line);
      }
    }

    if (pendingTargetLines.length > 0) {
      flushTurn();
    }

    const trailingLines = [...pendingInputLines];
    const trailingText = trailingLines.map(formatInputLine).filter(Boolean).join("\n");

    washedScenes.push({
      sceneId: rawScene.scene_id,
      order: rawScene.order,
      chapter: extractChapterFromSceneId(rawScene.scene_id),
      title: rawScene.title || rawScene.scene_id,
      setting: rawScene.setting || rawScene.setting_time || "未知",
      isHScene,
      characters: rawScene.characters,
      rawLineCount: rawScene.line_count,
      turns,
      trailingLines,
      trailingText,
    });
  }

  const stats: DatasetWashStats = {
    totalRawScenes: script.scenes.length,
    storyScenesWithTarget,
    nonHScenesWithTarget,
    hScenesWithTarget,
    selectedSceneCount: washedScenes.length,
    totalRawTargetLines,
    totalTurnBundles: globalTurnIndex,
    explicitTargetMonologues,
    speakerAliasCounts,
  };

  return {
    targetCharacter: "白花",
    protagonistCharacter: "苍空",
    stats,
    scenes: washedScenes,
  };
}

/**
 * Loads and washes a Galgame JSON script from disk.
 */
export function loadGalgameDataset(
  jsonPath: string,
  options: WashDatasetOptions = {},
): WashedDataset {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as RawGalgameScript;
  return washGalgameScript(raw, options);
}
