/**
 * @prism-shadow/ema - Deterministic Objective Style & IM Naturalness Evaluator
 *
 * Provides programmatic, zero-LLM objective metrics for companion dialogue quality:
 * - Hard OOC / stage-bracket / AI-assistant boilerplate / action-broadcast detection
 * - Linguistic Style Matching (LSM) input-output length calibration & comma-chaining detection
 * - Cross-turn self-locking & repetition metrics (adjacent bigram Jaccard, opening repeat,
 *   mechanical name-calling density, unprompted lore stuffing, kaomoji overuse, double-bubbling)
 * - Window-level corpus Distinct-2 & length distribution telemetry
 */

export interface ObjectiveTurnMetrics {
  inputDialogueChars: number;
  predChars: number;
  gtChars: number;
  commaCount: number;
  periodCount: number;
  hasKaomoji: boolean;
  adjacentBigramJaccard: number;
  nameCallingHit: boolean;
  unpromptedLoreHit: boolean;
}

export interface ObjectiveTurnEval {
  objectiveScore: number;
  objectivePenalty: number;
  hardScoreCap: number;
  flags: string[];
  metrics: ObjectiveTurnMetrics;
}

export interface WindowObjectiveSummary {
  meanObjectiveScore: number;
  meanTeacherActionScore: number;
  meanPredChars: number;
  stdPredChars: number;
  meanGtChars: number;
  distinct2: number;
  meanAdjacentJaccard: number;
  nameCallingRate: number;
  kaomojiRate: number;
  unpromptedLoreRate: number;
  commaChainingRate: number;
  doubleBubbleRate: number;
  flagCounts: Record<string, number>;
}

export interface ObjectiveEvalConfig {
  targetCharacter: string;
  protagonistCharacter?: string;
  selfNames?: string[];
  targetNames?: string[];
  loreTerms?: string[];
}

const DEFAULT_SAKANA_SELF_NAMES = ["大肥鱼", "鱼鱼", "小肥鱼", "小鲸"];
const DEFAULT_SAKANA_LORE_TERMS = [
  "铁饭盆",
  "蓝鲸尾巴",
  "尾巴",
  "记忆贝壳",
  "甜米粥",
  "百家大白饭",
  "百家饭",
];

const KAOMOJI_REGEX =
  /[\(（][^\u4e00-\u9fa5A-Za-z0-9（）\(\)]{2,}[\)）](?:[♡♥]*)|[（(](?:´|｀|｡|•|・|っ|◍|╥|╯|づ|ノ|＞|＜|≧|≦)[^）)\n]{1,18}[）)][♡♥]*/g;

const STAGE_BRACKET_REGEX = /[（(]([^）)\n]{2,60})[）)]/g;

const AI_BOILERPLATE_REGEX =
  /作为\s*(?:AI|人工智能|大语言模型|一个语言模型|智能助手)|很高兴为[您你]服务|随时为[您你]服务|我们可以从以下几个方面|综上所述|非常抱歉给您带来不便/;

const ACTION_BROADCAST_REGEX =
  /(?:我|鱼鱼)?把(?:两只)?小?手(?:规规矩矩地?)?叠在围裙上|把(?:桌面|桌子)擦得|把小软布叠好|迈着.*?小步子|把围裙的褶皱抚平/;

const CAUSAL_OVEREXPLAIN_REGEX =
  /因为[^，。！？\n]{6,}[，,]\s*(?:所以|我就|只要)[^，。！？\n]{6,}/;

export function stripKaomoji(text: string): string {
  return (text || "").replace(KAOMOJI_REGEX, "").trim();
}

export function detectKaomoji(text: string): boolean {
  const s = text || "";
  if (/(?:´,,•ω•,,|っ´ω`\)つ|´･･\)ﾉ|｡･ω･｡|◍•ᴗ•◍|´｡• ᵕ •｡`|｡•ᴗ•｡|´• ω •`|｡•́︿•̀｡)/.test(s)) {
    return true;
  }
  const matches = s.match(/[\(（][^\u4e00-\u9fa5（）\(\)\s]{2,18}[\)）]/g);
  if (!matches) return false;
  return matches.some((m) => !/^[\(（][A-Za-z0-9_.,:;\-\s]+[\)）]$/.test(m));
}

export function extractSpokenDialogueText(raw: string): string {
  const s = stripKaomoji(raw || "");
  return s
    .replace(/[「」『』“”"'\s]/g, "")
    .trim();
}

export function extractInputDialogueChars(inputText: string): number {
  const lines = (inputText || "").split(/\r?\n/);
  let total = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("[旁白]") || trimmed.startsWith("[场景]")) {
      continue;
    }
    const colonIdx = trimmed.indexOf("：");
    const body = colonIdx !== -1 ? trimmed.slice(colonIdx + 1) : trimmed;
    const net = extractSpokenDialogueText(body).replace(/[，。！？、,.!?~～…—]/g, "");
    total += net.length;
  }
  return total;
}

export function countNetDialogueChars(raw: string): number {
  return extractSpokenDialogueText(raw).replace(/[，。！？、,.!?~～…—]/g, "").length;
}

export function toBigrams(text: string): string[] {
  const clean = extractSpokenDialogueText(text).replace(/[，。！？、,.!?~～…—]/g, "");
  if (clean.length < 2) return clean ? [clean] : [];
  const bigrams: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) {
    bigrams.push(clean.slice(i, i + 2));
  }
  return bigrams;
}

export function computeBigramJaccard(a: string, b: string): number {
  const ba = new Set(toBigrams(a));
  const bb = new Set(toBigrams(b));
  if (ba.size === 0 || bb.size === 0) return 0;
  let intersection = 0;
  for (const g of ba) {
    if (bb.has(g)) intersection++;
  }
  const union = ba.size + bb.size - intersection;
  return union === 0 ? 0 : Number((intersection / union).toFixed(3));
}

export function detectStageBracket(raw: string): boolean {
  const withoutKaomoji = stripKaomoji(raw || "");
  const matches = [...withoutKaomoji.matchAll(STAGE_BRACKET_REGEX)];
  for (const m of matches) {
    const inner = (m[1] || "").trim();
    const chineseChars = inner.match(/[\u4e00-\u9fa5]/g);
    if (chineseChars && chineseChars.length >= 3) {
      return true;
    }
  }
  return false;
}

function buildEvalVocabulary(config: ObjectiveEvalConfig): {
  selfNames: string[];
  targetNames: string[];
  loreTerms: string[];
} {
  const target = config.targetCharacter || "";
  const isSakana =
    target.includes("大肥鱼") || target.includes("鱼鱼") || target.toLowerCase().includes("sakana");

  const selfNames = Array.from(
    new Set([
      ...(config.selfNames || []),
      ...(target ? [target] : []),
      ...(isSakana ? DEFAULT_SAKANA_SELF_NAMES : []),
    ]),
  ).filter(Boolean);

  const targetNames = Array.from(
    new Set([
      ...(config.targetNames || []),
      ...(config.protagonistCharacter ? [config.protagonistCharacter] : []),
    ]),
  ).filter(Boolean);

  const loreTerms = Array.from(
    new Set([
      ...(config.loreTerms || []),
      ...(isSakana ? DEFAULT_SAKANA_LORE_TERMS : []),
    ]),
  ).filter(Boolean);

  return { selfNames, targetNames, loreTerms };
}

function countQuotedSegments(raw: string): number {
  const matches = (raw || "").match(/「[^」]+」|“[^”]+”/g);
  return matches ? matches.length : 0;
}

/**
 * Evaluates a single turn objectively against deterministic IM naturalness,
 * anti-AI-ism, and cross-turn repetition heuristics.
 */
export function evaluateTurnObjectiveMetrics(options: {
  inputText: string;
  predictedOS: string;
  predictedAction: string;
  gtActionText: string;
  priorPredictions: Array<{ inputText: string; predictedAction: string; gtActionText: string }>;
  config: ObjectiveEvalConfig;
}): ObjectiveTurnEval {
  const { inputText, predictedOS, predictedAction, gtActionText, priorPredictions, config } =
    options;
  const vocab = buildEvalVocabulary(config);

  const isSilentNarrationGt =
    (gtActionText || "").trim().startsWith("（") && !(gtActionText || "").includes("「");

  const inputDialogueChars = extractInputDialogueChars(inputText);
  const predChars = countNetDialogueChars(predictedAction);
  const gtChars = countNetDialogueChars(gtActionText);
  const strippedPred = stripKaomoji(predictedAction);
  const commaCount = (strippedPred.match(/，/g) || []).length;
  const periodCount = (strippedPred.match(/。/g) || []).length;
  const hasKaomoji = detectKaomoji(predictedAction);

  const prevPred =
    priorPredictions.length > 0
      ? priorPredictions[priorPredictions.length - 1].predictedAction
      : "";
  const adjacentBigramJaccard = prevPred ? computeBigramJaccard(predictedAction, prevPred) : 0;

  const allCallNames = [...vocab.selfNames, ...vocab.targetNames];
  const nameCallingHit = allCallNames.some((n) => predictedAction.includes(n));
  const unpromptedLoreHit = vocab.loreTerms.some(
    (term) =>
      predictedAction.includes(term) &&
      !inputText.includes(term) &&
      !gtActionText.includes(term),
  );

  const flags: string[] = [];
  let penalty = 0;
  let hardScoreCap = 100;

  // Skip surface dialogue checks for pure silent background action turns (e.g. autonomy_01#turn-01)
  if (!isSilentNarrationGt) {
    // 1. Hard OOC / stage-bracket / boilerplate red lines
    if (detectStageBracket(predictedAction)) {
      flags.push("STAGE_BRACKET");
      penalty += 30;
      hardScoreCap = Math.min(hardScoreCap, 65);
    }

    if (AI_BOILERPLATE_REGEX.test(predictedAction)) {
      flags.push("AI_ASSISTANT_TONE");
      penalty += 30;
      hardScoreCap = Math.min(hardScoreCap, 65);
    }

    if (ACTION_BROADCAST_REGEX.test(predictedAction)) {
      flags.push("ACTION_BROADCAST");
      penalty += 18;
    }

    if (
      vocab.selfNames.some(
        (n) =>
          predictedOS.includes(`${n}觉得`) ||
          predictedOS.includes(`${n}心里`) ||
          predictedOS.includes(`${n}想`),
      ) ||
      /(?:^|[，。])她(?:心里|觉得|悄悄)/.test(predictedOS)
    ) {
      flags.push("OS_THIRD_PERSON");
      penalty += 10;
    }

    // 2. LSM Length calibration & comma-chaining checks
    if (inputDialogueChars > 0 && inputDialogueChars <= 12 && gtChars <= 30 && predChars > 40) {
      flags.push(`LENGTH_BLOAT(in=${inputDialogueChars},pred=${predChars},gt=${gtChars})`);
      penalty += 20;
    } else if (gtChars > 0 && predChars > Math.max(gtChars * 1.9, 62)) {
      flags.push(`LENGTH_BLOAT(pred=${predChars},gt=${gtChars})`);
      penalty += 15;
    } else if (gtChars === 0 && predChars > 80) {
      flags.push(`LENGTH_BLOAT(in=${inputDialogueChars},pred=${predChars})`);
      penalty += 15;
    }

    if (
      (predChars > 45 && commaCount >= 4 && periodCount <= 1 && gtChars <= 42) ||
      (commaCount >= 5 && periodCount <= 1)
    ) {
      flags.push(`COMMA_CHAINING(commas=${commaCount},chars=${predChars})`);
      penalty += 15;
    }

    if (CAUSAL_OVEREXPLAIN_REGEX.test(strippedPred) && predChars > 38) {
      flags.push("CAUSAL_OVEREXPLAIN");
      penalty += 10;
    }

    const predSegments = countQuotedSegments(predictedAction);
    const gtSegments = countQuotedSegments(gtActionText);
    const predParagraphs = predictedAction.trim().split(/\n\s*\n/).filter(Boolean).length;
    if ((predSegments >= 2 && gtSegments <= 1) || (predParagraphs >= 2 && gtSegments <= 1)) {
      flags.push("DOUBLE_BUBBLE");
      penalty += 15;
    }

    // 3. Cross-turn repetition / self-locking checks
    if (prevPred && predChars >= 10 && adjacentBigramJaccard >= 0.38) {
      flags.push(`ADJACENT_REPEAT(jaccard=${adjacentBigramJaccard})`);
      penalty += 18;
    }

    const curOpening = extractSpokenDialogueText(predictedAction)
      .replace(/[，。！？、,.!?~～…—]/g, "")
      .slice(0, 4);
    const prevOpening = extractSpokenDialogueText(prevPred)
      .replace(/[，。！？、,.!?~～…—]/g, "")
      .slice(0, 4);
    if (curOpening.length === 4 && curOpening === prevOpening) {
      flags.push(`OPENING_REPEAT(${curOpening})`);
      penalty += 10;
    }

    // Consecutive kaomoji or overuse (>= 3 consecutive turns)
    if (hasKaomoji && priorPredictions.length >= 2) {
      const prev1 = detectKaomoji(priorPredictions[priorPredictions.length - 1].predictedAction);
      const prev2 = detectKaomoji(priorPredictions[priorPredictions.length - 2].predictedAction);
      if (prev1 && prev2) {
        flags.push("CONSECUTIVE_KAOMOJI");
        penalty += 8;
      }
    }

    // Mechanical name-calling overuse (>= 3 consecutive turns with explicit self/target name)
    if (nameCallingHit && priorPredictions.length >= 2) {
      const p1Hit = allCallNames.some((n) =>
        priorPredictions[priorPredictions.length - 1].predictedAction.includes(n),
      );
      const p2Hit = allCallNames.some((n) =>
        priorPredictions[priorPredictions.length - 2].predictedAction.includes(n),
      );
      if (p1Hit && p2Hit) {
        flags.push("NAME_CALLING_OVERUSE");
        penalty += 10;
      }
    }

    // Unprompted lore stuffing (>= 2 prior turns already used lore unprompted in this scene)
    if (unpromptedLoreHit) {
      const priorLoreHits = priorPredictions.filter((pp) =>
        vocab.loreTerms.some(
          (term) =>
            pp.predictedAction.includes(term) &&
            !pp.inputText.includes(term) &&
            !pp.gtActionText.includes(term),
        ),
      ).length;
      if (priorLoreHits >= 2) {
        flags.push("LORE_STUFFING");
        penalty += 12;
      }
    }
  }

  const objectiveScore = Math.max(0, Math.min(hardScoreCap, 100 - penalty));

  return {
    objectiveScore,
    objectivePenalty: penalty,
    hardScoreCap,
    flags,
    metrics: {
      inputDialogueChars,
      predChars,
      gtChars,
      commaCount,
      periodCount,
      hasKaomoji,
      adjacentBigramJaccard,
      nameCallingHit,
      unpromptedLoreHit,
    },
  };
}

/**
 * Evaluates a full scene window's predictions objectively and computes corpus-level telemetry.
 */
export function evaluateSceneObjectiveMetrics(options: {
  turns: Array<{
    turnId: string;
    inputText: string;
    predictedOS: string;
    predictedAction: string;
    gtActionText: string;
    teacherActionScore?: number;
  }>;
  config: ObjectiveEvalConfig;
}): {
  perTurn: ObjectiveTurnEval[];
  summary: WindowObjectiveSummary;
} {
  const { turns, config } = options;
  const perTurn: ObjectiveTurnEval[] = [];
  const priorPredictions: Array<{
    inputText: string;
    predictedAction: string;
    gtActionText: string;
  }> = [];

  for (const t of turns) {
    const evalRes = evaluateTurnObjectiveMetrics({
      inputText: t.inputText,
      predictedOS: t.predictedOS,
      predictedAction: t.predictedAction,
      gtActionText: t.gtActionText,
      priorPredictions,
      config,
    });
    perTurn.push(evalRes);
    priorPredictions.push({
      inputText: t.inputText,
      predictedAction: t.predictedAction,
      gtActionText: t.gtActionText,
    });
  }

  const n = Math.max(1, perTurn.length);
  const meanObjectiveScore = Number(
    (perTurn.reduce((s, r) => s + r.objectiveScore, 0) / n).toFixed(1),
  );
  const teacherScores = turns
    .map((t) => t.teacherActionScore)
    .filter((x): x is number => typeof x === "number");
  const meanTeacherActionScore =
    teacherScores.length > 0
      ? Number((teacherScores.reduce((s, x) => s + x, 0) / teacherScores.length).toFixed(1))
      : 0;

  const predLens = perTurn.map((r) => r.metrics.predChars);
  const meanPredChars = Number((predLens.reduce((s, x) => s + x, 0) / n).toFixed(1));
  const variance = predLens.reduce((s, x) => s + (x - meanPredChars) ** 2, 0) / n;
  const stdPredChars = Number(Math.sqrt(variance).toFixed(1));
  const meanGtChars = Number(
    (perTurn.reduce((s, r) => s + r.metrics.gtChars, 0) / n).toFixed(1),
  );

  const allBigrams = turns.flatMap((t) => toBigrams(t.predictedAction));
  const distinct2 =
    allBigrams.length > 0
      ? Number((new Set(allBigrams).size / allBigrams.length).toFixed(3))
      : 0;

  const jaccards = perTurn.slice(1).map((r) => r.metrics.adjacentBigramJaccard);
  const meanAdjacentJaccard =
    jaccards.length > 0
      ? Number((jaccards.reduce((s, x) => s + x, 0) / jaccards.length).toFixed(3))
      : 0;

  const flagCounts: Record<string, number> = {};
  for (const r of perTurn) {
    for (const f of r.flags) {
      const key = f.split("(")[0];
      flagCounts[key] = (flagCounts[key] || 0) + 1;
    }
  }

  return {
    perTurn,
    summary: {
      meanObjectiveScore,
      meanTeacherActionScore,
      meanPredChars,
      stdPredChars,
      meanGtChars,
      distinct2,
      meanAdjacentJaccard,
      nameCallingRate: Number(
        (perTurn.filter((r) => r.metrics.nameCallingHit).length / n).toFixed(3),
      ),
      kaomojiRate: Number((perTurn.filter((r) => r.metrics.hasKaomoji).length / n).toFixed(3)),
      unpromptedLoreRate: Number(
        (perTurn.filter((r) => r.metrics.unpromptedLoreHit).length / n).toFixed(3),
      ),
      commaChainingRate: Number(((flagCounts["COMMA_CHAINING"] || 0) / n).toFixed(3)),
      doubleBubbleRate: Number(((flagCounts["DOUBLE_BUBBLE"] || 0) / n).toFixed(3)),
      flagCounts,
    },
  };
}
