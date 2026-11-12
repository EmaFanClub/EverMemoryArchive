/**
 * @prism-shadow/ema - Narrative Script Dataset Washer & Turn-Bundle Builder
 *
 * Transforms structured visual novel / narrative dialogue scripts into
 * sequential SceneWindows and TurnBundles D = {q_1, ..., q_T} for any target character.
 */

import fs from "node:fs";
import type {
  DatasetWashStats,
  RawGalgameScript,
  RawScriptLine,
  SceneWindow,
  TurnBundle,
  WashedDataset,
} from "./types.js";

export interface WashDatasetOptions {
  /** Primary target character name to train as the companion */
  targetCharacter?: string;
  /** Counterpart / protagonist name in the script (defaults to "主角") */
  protagonistCharacter?: string;
  /** Additional speaker aliases mapped to the target character */
  speakerAliases?: string[];
  /** Scene-specific speaker aliases (e.g. pre-reveal mystery speaker in a specific scene) */
  sceneSpeakerOverrides?: Record<string, string[]>;
  /** Exclude adult/H-scenes from the training sequence; defaults to true */
  excludeHScenes?: boolean;
  /** Optional scene tag substring used to detect adult scenes (defaults to "Hシーン") */
  hSceneMarker?: string;
  /** Maximum story order index (optional filter for engine/preview placeholders) */
  maxOrder?: number;
  /** Optional scene ID filter or slice */
  sceneIds?: string[];
}

/**
 * Checks whether a script line is spoken/thought by the target character.
 */
export function isTargetSpeaker(
  speaker: string | null,
  sceneId: string,
  aliasSet: ReadonlySet<string>,
  sceneOverrides?: Record<string, string[]>,
): boolean {
  if (!speaker) return false;
  if (aliasSet.has(speaker)) return true;
  const overrides = sceneOverrides?.[sceneId];
  if (overrides && overrides.includes(speaker)) return true;
  return false;
}

/**
 * Extracts chapter identifier from a scene_id (e.g. "005_ch01_05" -> "ch01").
 */
export function extractChapterFromSceneId(sceneId: string): string {
  const parts = sceneId.split("_");
  if (parts.length >= 2) {
    return parts[1];
  }
  return "default";
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
    const cleanMono = text.replace(/^[（(]+|[）)]+$/g, "").trim();
    return `【${line.speaker}】(内心): （${cleanMono}）`;
  }
  const cleanDiag = text.replace(/^[“「]+|[”」]+$/g, "").trim();
  return `【${line.speaker}】: 「${cleanDiag}」`;
}

/**
 * Formats consecutive target-character lines into Ground Truth Action_t^*.
 */
export function formatTargetActionLines(lines: RawScriptLine[]): {
  gtActionText: string;
  explicitOS: string | null;
} {
  const spokenParts: string[] = [];
  const osParts: string[] = [];

  for (const line of lines) {
    const text = (line.text || "").trim();
    if (!text) continue;
    if (line.type === "monologue") {
      const cleanMono = text.replace(/^[（(]+|[）)]+$/g, "").trim();
      osParts.push(cleanMono);
    } else if (line.type === "narration") {
      const cleanNarr = text.replace(/^[（(]+|[）)]+$/g, "").trim();
      spokenParts.push(`（${cleanNarr}）`);
    } else {
      const cleanDiag = text.replace(/^[“「]+|[”」]+$/g, "").trim();
      spokenParts.push(`「${cleanDiag}」`);
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

/**
 * Infers the most frequent non-protagonist speaker in the script when `targetCharacter`
 * is not explicitly passed.
 */
function inferDefaultTargetSpeaker(script: RawGalgameScript, protagonist?: string): string {
  const counts = new Map<string, number>();
  for (const scene of script.scenes) {
    for (const line of scene.lines) {
      if (line.speaker && line.speaker !== protagonist) {
        counts.set(line.speaker, (counts.get(line.speaker) || 0) + 1);
      }
    }
  }
  let best = "Target";
  let bestCount = -1;
  for (const [sp, count] of counts.entries()) {
    if (count > bestCount) {
      best = sp;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Washes a parsed RawGalgameScript into SceneWindows and TurnBundles.
 */
export function washGalgameScript(
  script: RawGalgameScript,
  options: WashDatasetOptions = {},
): WashedDataset {
  const protagonistCharacter = options.protagonistCharacter || "主角";
  const targetCharacter =
    options.targetCharacter || inferDefaultTargetSpeaker(script, protagonistCharacter);
  const aliasSet = new Set<string>([targetCharacter, ...(options.speakerAliases || [])]);
  const sceneOverrides = options.sceneSpeakerOverrides;
  const excludeHScenes = options.excludeHScenes ?? true;
  const hSceneMarker = options.hSceneMarker ?? "Hシーン";
  const maxOrder = options.maxOrder ?? Number.POSITIVE_INFINITY;
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

    const hasTarget = rawScene.lines.some((l) =>
      isTargetSpeaker(l.speaker, rawScene.scene_id, aliasSet, sceneOverrides),
    );
    if (!hasTarget) continue;

    const isHScene = Boolean(hSceneMarker && rawScene.scene_id.includes(hSceneMarker));
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

      const { gtActionText, explicitOS } = formatTargetActionLines(pendingTargetLines);

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
      if (isTargetSpeaker(line.speaker, rawScene.scene_id, aliasSet, sceneOverrides)) {
        const sp = line.speaker || targetCharacter;
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
    targetCharacter,
    protagonistCharacter,
    stats,
    scenes: washedScenes,
  };
}

/**
 * Loads and washes a narrative JSON script from disk.
 */
export function loadGalgameDataset(
  jsonPath: string,
  options: WashDatasetOptions = {},
): WashedDataset {
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as RawGalgameScript;
  return washGalgameScript(raw, options);
}
