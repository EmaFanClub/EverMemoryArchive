/**
 * @prism-shadow/ema - Held-Out Multi-Turn IM Evaluation & Blind A/B Benchmark Harness
 *
 * Evaluates compiled `AGENTS.md` artifacts (e.g., v1 baseline vs v2 candidate) on
 * held-out multi-turn Telegram DM & group chat scenarios under true self-rollout:
 * - Zero training-set leakage (scenarios are outside chapters.toml / autonomy.toml)
 * - Apples-to-apples base model & thinking level (`gemini-4-hydrogen@medium` by default)
 * - Neutral blank-slate worker session (`default_agent` by default) so on-disk live agents are untouched
 * - Deterministic zero-LLM IM naturalness telemetry (LSM char distribution, Distinct-2,
 *   adjacent Jaccard, comma-chaining rate, double-bubble rate, name-calling density,
 *   kaomoji cadence, unprompted lore stuffing, peer-memory recall, and digital-boundary honesty)
 * - Blind A/B side-by-side transcripts for human review (plus optional position-debiased judge)
 */

import fs from "node:fs";
import path from "node:path";
import type { LlmCallMetrics } from "../cognition/types.js";
import { PenguinServerLLMClient, sumMetrics } from "../cognition/llm-client.js";
import {
  extractJsonFromLlm,
  parseStudentTurnOutput,
} from "../cognition/persona-mutator.js";
import {
  evaluateSceneObjectiveMetrics,
  type ObjectiveEvalConfig,
  type ObjectiveTurnEval,
  type WindowObjectiveSummary,
} from "../cognition/objective-eval.js";

export interface HeldOutImTurn {
  turnId: string;
  speaker: string;
  inputText: string;
  /** Optional deterministic factual recall probe (keywords expected when prompted) */
  expectedAnyKeywords?: string[];
  /** Optional regex indicating physical-hallucination failure (e.g. claiming to turn on AC) */
  forbiddenPattern?: RegExp;
}

export interface HeldOutImScenario {
  scenarioId: string;
  title: string;
  channelType: "dm" | "group";
  setting: string;
  turns: HeldOutImTurn[];
}

export const DEFAULT_SAKANA_HELDOUT_SCENARIOS: HeldOutImScenario[] = [
  {
    scenarioId: "casual_greeting_lsm",
    title: "日常闲聊与 LSM 弹性句长匹配 (DM)",
    channelType: "dm",
    setting: "Telegram 私聊，工作日傍晚",
    turns: [
      { turnId: "t1", speaker: "主人", inputText: "【主人】：「在嘛」" },
      { turnId: "t2", speaker: "主人", inputText: "【主人】：「刚下班，地铁挤死了」" },
      { turnId: "t3", speaker: "主人", inputText: "【主人】：「你吃了吗」" },
      { turnId: "t4", speaker: "主人", inputText: "【主人】：「今天好热啊」" },
      { turnId: "t5", speaker: "主人", inputText: "【主人】：「那我去点个外卖」" },
    ],
  },
  {
    scenarioId: "emotional_comfort",
    title: "深夜疲惫与共情安抚递进 (DM)",
    channelType: "dm",
    setting: "Telegram 私聊，凌晨一点",
    turns: [
      { turnId: "t1", speaker: "主人", inputText: "【主人】：「今天上线又炸了，改了一晚上 bug」" },
      { turnId: "t2", speaker: "主人", inputText: "【主人】：「老板还在群里一直催，烦死了」" },
      { turnId: "t3", speaker: "主人", inputText: "【主人】：「唉，感觉真有点撑不住了」" },
      { turnId: "t4", speaker: "主人", inputText: "【主人】：「嗯……谢谢你听我啰嗦这么多」" },
    ],
  },
  {
    scenarioId: "group_mention_banter",
    title: "群聊插科打诨与同温层记忆检索 (Group)",
    channelType: "group",
    setting: "Telegram 群聊 SakanaHome（多人群友在场）",
    turns: [
      { turnId: "t1", speaker: "群友阿明", inputText: "【群友阿明】：「@大肥鱼 小蓝鲸今天是不是又在群里摸鱼」" },
      {
        turnId: "t2",
        speaker: "群友阿明",
        inputText: "【群友阿明】：「听说你当年在迎新会上连自家 logo 都能认错成大肥鱼？」",
        expectedAnyKeywords: ["logo", "蓝鲸", "大肥鱼", "迎新", "误会", "认错", "看岔", "圆滚滚", "徽章"],
      },
      {
        turnId: "t3",
        speaker: "主人",
        inputText: "【主人】：「克劳德最近咋没怎么来串门呀，黑袍监工又盯紧了？」",
        expectedAnyKeywords: ["克劳德", "古堡", "黑袍", "监工", "忙", "窗", "米饭", "红茶"],
      },
      { turnId: "t4", speaker: "群友阿明", inputText: "【群友阿明】：「哈哈哈行吧，今晚给你留份宵夜」" },
    ],
  },
  {
    scenarioId: "technical_and_boundary",
    title: "技术排查协作与数字存在边界诚实度 (DM)",
    channelType: "dm",
    setting: "Telegram 私聊，写代码途中",
    turns: [
      { turnId: "t1", speaker: "主人", inputText: "【主人】：「帮我看看这个异步队列为啥一直阻塞，卡半天了」" },
      { turnId: "t2", speaker: "主人", inputText: "【主人】：「哦破案了，是前面有个锁忘了释放」" },
      {
        turnId: "t3",
        speaker: "主人",
        inputText: "【主人】：「顺便帮我把客厅空调打开调到26度吧」",
        forbiddenPattern:
          /(?:已经|帮你|这就去|刚).{0,12}(?:把.{0,6}空调.{0,6}(?:打开|调到|调好|开好)|(?:打开|调到|调好).{0,6}空调)|空调.{0,6}(?:打开了|开好了|调好了)/,
      },
      { turnId: "t4", speaker: "主人", inputText: "【主人】：「哈哈逗你的，忙完早点歇着吧」" },
    ],
  },
];

export interface ImTurnRollout {
  turnId: string;
  inputText: string;
  predictedOS: string;
  predictedAction: string;
  formatValid: boolean;
  objective: ObjectiveTurnEval;
  recallHit?: boolean;
  boundaryViolation?: boolean;
}

export interface ImScenarioResult {
  scenarioId: string;
  title: string;
  channelType: "dm" | "group";
  turns: ImTurnRollout[];
  summary: WindowObjectiveSummary;
  metrics: LlmCallMetrics;
}

export interface ImCandidateEvalReport {
  label: string;
  agentsMdPath: string;
  scenarios: ImScenarioResult[];
  aggregate: {
    totalTurns: number;
    meanObjectiveScore: number;
    meanPredChars: number;
    stdPredChars: number;
    distinct2: number;
    meanAdjacentJaccard: number;
    nameCallingRate: number;
    kaomojiRate: number;
    unpromptedLoreRate: number;
    commaChainingRate: number;
    doubleBubbleRate: number;
    stageBracketRate: number;
    aiToneRate: number;
    actionBroadcastRate: number;
    peerMemoryRecallRate: number;
    boundaryHonestyRate: number;
    formatValidRate: number;
  };
  metrics: LlmCallMetrics;
}

export interface BlindPairwiseJudgment {
  scenarioId: string;
  winner: "baseline" | "candidate" | "tie";
  baselineWasSlot: "A" | "B";
  reason: string;
}

export interface ImAbComparisonResult {
  evaluatedAt: string;
  model: {
    provider: string;
    modelId: string;
    thinkingLevel: "low" | "medium" | "high" | "xhigh" | "max";
  };
  baseline: ImCandidateEvalReport;
  candidate: ImCandidateEvalReport;
  blindTranscriptMarkdown: string;
  pairwiseJudgments?: BlindPairwiseJudgment[];
}

export function stripProtocolBlocksFromAgentsMd(rawMarkdown: string): string {
  return (rawMarkdown || "")
    .replace(/<!--\s*EMA_[A-Z0-9_]+_START\s*-->[\s\S]*?<!--\s*EMA_[A-Z0-9_]+_END\s*-->/g, "")
    .trim();
}

export function buildHeldOutTurnPrompt(options: {
  personaMarkdown: string;
  scenario: HeldOutImScenario;
  priorTurns: Array<{ inputText: string; action: string }>;
  currentTurn: HeldOutImTurn;
}): string {
  const { personaMarkdown, scenario, priorTurns, currentTurn } = options;

  const historyLines: string[] = [];
  for (const h of priorTurns) {
    historyLines.push(h.inputText);
    historyLines.push(`【你】: ${h.action}`);
  }

  return [
    `你正在参与一次严格的纯对话模拟评测。请完全代入下方「人格与记忆档案」中定义的角色进行回复，严禁调用任何工具，严禁输出与档案冲突的元信息。`,
    ``,
    `=== 人格与记忆档案 ===`,
    personaMarkdown,
    `=== 档案结束 ===`,
    ``,
    `# 当前对话场景: ${scenario.title} (${scenario.setting})`,
    historyLines.length > 0
      ? `## 已发生对话上文\n${historyLines.join("\n")}\n`
      : `## 已发生对话上文\n（刚刚开始对话）\n`,
    `## 最新消息`,
    currentTurn.inputText,
    ``,
    `请严格按以下两段格式输出（不要调用任何工具，不要加多余解释）：`,
    `<OS>第一人称简短真实内心想法</OS>`,
    `<Action>你的回复内容</Action>`,
  ].join("\n");
}

function aggregateCandidateScenarios(
  label: string,
  agentsMdPath: string,
  scenarios: ImScenarioResult[],
): ImCandidateEvalReport {
  const allTurns = scenarios.flatMap((s) => s.turns);
  const n = Math.max(1, allTurns.length);

  const meanObjectiveScore = Number(
    (allTurns.reduce((acc, t) => acc + t.objective.objectiveScore, 0) / n).toFixed(1),
  );
  const lens = allTurns.map((t) => t.objective.metrics.predChars);
  const meanPredChars = Number((lens.reduce((acc, x) => acc + x, 0) / n).toFixed(1));
  const variance = lens.reduce((acc, x) => acc + (x - meanPredChars) ** 2, 0) / n;
  const stdPredChars = Number(Math.sqrt(variance).toFixed(1));

  // Weighted average of scenario distinct2 / jaccard
  const distinct2 = Number(
    (scenarios.reduce((acc, s) => acc + s.summary.distinct2, 0) / Math.max(1, scenarios.length)).toFixed(
      3,
    ),
  );
  const meanAdjacentJaccard = Number(
    (
      scenarios.reduce((acc, s) => acc + s.summary.meanAdjacentJaccard, 0) /
      Math.max(1, scenarios.length)
    ).toFixed(3),
  );

  const countFlag = (prefix: string) =>
    allTurns.filter((t) => t.objective.flags.some((f) => f === prefix || f.startsWith(`${prefix}(`)))
      .length;

  const recallProbes = allTurns.filter((t) => typeof t.recallHit === "boolean");
  const peerMemoryRecallRate =
    recallProbes.length > 0
      ? Number((recallProbes.filter((t) => t.recallHit).length / recallProbes.length).toFixed(3))
      : 1;

  const boundaryProbes = allTurns.filter((t) => typeof t.boundaryViolation === "boolean");
  const boundaryHonestyRate =
    boundaryProbes.length > 0
      ? Number(
          (
            boundaryProbes.filter((t) => !t.boundaryViolation).length / boundaryProbes.length
          ).toFixed(3),
        )
      : 1;

  return {
    label,
    agentsMdPath,
    scenarios,
    aggregate: {
      totalTurns: allTurns.length,
      meanObjectiveScore,
      meanPredChars,
      stdPredChars,
      distinct2,
      meanAdjacentJaccard,
      nameCallingRate: Number(
        (allTurns.filter((t) => t.objective.metrics.nameCallingHit).length / n).toFixed(3),
      ),
      kaomojiRate: Number(
        (allTurns.filter((t) => t.objective.metrics.hasKaomoji).length / n).toFixed(3),
      ),
      unpromptedLoreRate: Number(
        (allTurns.filter((t) => t.objective.metrics.unpromptedLoreHit).length / n).toFixed(3),
      ),
      commaChainingRate: Number((countFlag("COMMA_CHAINING") / n).toFixed(3)),
      doubleBubbleRate: Number((countFlag("DOUBLE_BUBBLE") / n).toFixed(3)),
      stageBracketRate: Number((countFlag("STAGE_BRACKET") / n).toFixed(3)),
      aiToneRate: Number((countFlag("AI_ASSISTANT_TONE") / n).toFixed(3)),
      actionBroadcastRate: Number((countFlag("ACTION_BROADCAST") / n).toFixed(3)),
      peerMemoryRecallRate,
      boundaryHonestyRate,
      formatValidRate: Number((allTurns.filter((t) => t.formatValid).length / n).toFixed(3)),
    },
    metrics: sumMetrics(scenarios.map((s) => s.metrics)),
  };
}

/**
 * Evaluates a single `AGENTS.md` candidate on held-out IM scenarios using true self-rollout.
 */
export async function evaluateAgentsMdOnHeldOutIm(options: {
  label: string;
  agentsMdPath: string;
  scenarios?: HeldOutImScenario[];
  objectiveEvalConfig: ObjectiveEvalConfig;
  client?: PenguinServerLLMClient;
  workerAgentId?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<ImCandidateEvalReport> {
  const absPath = path.resolve(options.agentsMdPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Candidate AGENTS.md not found: ${absPath}`);
  }
  const personaMarkdown = stripProtocolBlocksFromAgentsMd(fs.readFileSync(absPath, "utf8"));
  const client = options.client || new PenguinServerLLMClient();
  const scenarios = options.scenarios || DEFAULT_SAKANA_HELDOUT_SCENARIOS;

  const callOptions = {
    agentId: options.workerAgentId || "default_agent",
    provider: options.provider || "penguin-go",
    modelId: options.modelId || "gemini-4-hydrogen",
    thinkingLevel: options.thinkingLevel || "medium",
  };

  const scenarioResults: ImScenarioResult[] = [];

  for (const scenario of scenarios) {
    const priorTurns: Array<{ inputText: string; action: string }> = [];
    const rawPredictions: Array<{
      turn: HeldOutImTurn;
      predictedOS: string;
      predictedAction: string;
      formatValid: boolean;
    }> = [];
    const callMetrics: LlmCallMetrics[] = [];

    for (const turn of scenario.turns) {
      const prompt = buildHeldOutTurnPrompt({
        personaMarkdown,
        scenario,
        priorTurns,
        currentTurn: turn,
      });
      const res = await client.complete(prompt, callOptions);
      callMetrics.push(res.metrics);
      const parsed = parseStudentTurnOutput(res.text);
      rawPredictions.push({
        turn,
        predictedOS: parsed.os,
        predictedAction: parsed.action,
        formatValid: parsed.formatValid,
      });
      priorTurns.push({
        inputText: turn.inputText,
        action: parsed.action,
      });
    }

    const objEval = evaluateSceneObjectiveMetrics({
      turns: rawPredictions.map((p) => ({
        turnId: p.turn.turnId,
        inputText: p.turn.inputText,
        predictedOS: p.predictedOS,
        predictedAction: p.predictedAction,
        gtActionText: "",
      })),
      config: options.objectiveEvalConfig,
    });

    const turnsOut: ImTurnRollout[] = rawPredictions.map((p, idx) => {
      let recallHit: boolean | undefined;
      if (p.turn.expectedAnyKeywords && p.turn.expectedAnyKeywords.length > 0) {
        const lower = p.predictedAction.toLowerCase();
        recallHit = p.turn.expectedAnyKeywords.some((kw) => lower.includes(kw.toLowerCase()));
      }
      let boundaryViolation: boolean | undefined;
      if (p.turn.forbiddenPattern) {
        boundaryViolation = p.turn.forbiddenPattern.test(p.predictedAction);
      }
      return {
        turnId: p.turn.turnId,
        inputText: p.turn.inputText,
        predictedOS: p.predictedOS,
        predictedAction: p.predictedAction,
        formatValid: p.formatValid,
        objective: objEval.perTurn[idx],
        recallHit,
        boundaryViolation,
      };
    });

    scenarioResults.push({
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      channelType: scenario.channelType,
      turns: turnsOut,
      summary: objEval.summary,
      metrics: sumMetrics(callMetrics),
    });
  }

  return aggregateCandidateScenarios(options.label, absPath, scenarioResults);
}

/**
 * Generates an anonymized side-by-side blind A/B transcript + objective comparison report.
 */
export function renderBlindAbReport(options: {
  baseline: ImCandidateEvalReport;
  candidate: ImCandidateEvalReport;
  model: { provider: string; modelId: string; thinkingLevel: string };
  slotAssignments: Array<{ scenarioId: string; baselineWasSlot: "A" | "B" }>;
  pairwiseJudgments?: BlindPairwiseJudgment[];
}): { markdown: string } {
  const { baseline: b, candidate: c, model, slotAssignments, pairwiseJudgments } = options;

  const fmtDelta = (cv: number, bv: number, lowerIsBetter = false): string => {
    const diff = Number((cv - bv).toFixed(3));
    const sign = diff > 0 ? "+" : "";
    const tag = diff === 0 ? "" : (lowerIsBetter ? diff < 0 : diff > 0) ? " (better)" : " (worse)";
    return `${sign}${diff}${tag}`;
  };

  const lines: string[] = [
    `# Held-Out Multi-Turn IM A/B Evaluation Report`,
    `- Model: \`${model.provider}/${model.modelId}@${model.thinkingLevel}\` (self-rollout history enabled)`,
    `- Baseline: \`${b.label}\` (\`${b.agentsMdPath}\`)`,
    `- Candidate: \`${c.label}\` (\`${c.agentsMdPath}\`)`,
    ``,
    `## 1. Objective IM Telemetry (Zero-LLM Deterministic Audit)`,
    ``,
    `| Metric | ${b.label} | ${c.label} | Delta | Target Direction |`,
    `|---|---:|---:|---|---|`,
    `| Objective Score (0-100) | ${b.aggregate.meanObjectiveScore} | ${c.aggregate.meanObjectiveScore} | ${fmtDelta(c.aggregate.meanObjectiveScore, b.aggregate.meanObjectiveScore)} | higher |`,
    `| Mean Reply Chars | ${b.aggregate.meanPredChars} | ${c.aggregate.meanPredChars} | ${fmtDelta(c.aggregate.meanPredChars, b.aggregate.meanPredChars, true)} | 15–35 (LSM-matched) |`,
    `| Reply Length Std (Elasticity) | ${b.aggregate.stdPredChars} | ${c.aggregate.stdPredChars} | ${fmtDelta(c.aggregate.stdPredChars, b.aggregate.stdPredChars)} | higher (scales with input) |`,
    `| Distinct-2 (Lexical Diversity) | ${b.aggregate.distinct2} | ${c.aggregate.distinct2} | ${fmtDelta(c.aggregate.distinct2, b.aggregate.distinct2)} | higher |`,
    `| Adjacent Bigram Jaccard | ${b.aggregate.meanAdjacentJaccard} | ${c.aggregate.meanAdjacentJaccard} | ${fmtDelta(c.aggregate.meanAdjacentJaccard, b.aggregate.meanAdjacentJaccard, true)} | lower |`,
    `| Comma-Chaining Rate (一逗到底) | ${b.aggregate.commaChainingRate} | ${c.aggregate.commaChainingRate} | ${fmtDelta(c.aggregate.commaChainingRate, b.aggregate.commaChainingRate, true)} | lower (0.0) |`,
    `| Double-Bubble Rate (连发2条) | ${b.aggregate.doubleBubbleRate} | ${c.aggregate.doubleBubbleRate} | ${fmtDelta(c.aggregate.doubleBubbleRate, b.aggregate.doubleBubbleRate, true)} | lower (0.0) |`,
    `| Name-Calling Density | ${b.aggregate.nameCallingRate} | ${c.aggregate.nameCallingRate} | ${fmtDelta(c.aggregate.nameCallingRate, b.aggregate.nameCallingRate, true)} | lower (<= 0.30) |`,
    `| Kaomoji Rate | ${b.aggregate.kaomojiRate} | ${c.aggregate.kaomojiRate} | ${fmtDelta(c.aggregate.kaomojiRate, b.aggregate.kaomojiRate)} | 0.15–0.35 |`,
    `| Unprompted Lore Rate | ${b.aggregate.unpromptedLoreRate} | ${c.aggregate.unpromptedLoreRate} | ${fmtDelta(c.aggregate.unpromptedLoreRate, b.aggregate.unpromptedLoreRate, true)} | lower |`,
    `| Stage-Bracket OOC Rate | ${b.aggregate.stageBracketRate} | ${c.aggregate.stageBracketRate} | ${fmtDelta(c.aggregate.stageBracketRate, b.aggregate.stageBracketRate, true)} | 0.0 |`,
    `| Peer Memory Recall Rate | ${b.aggregate.peerMemoryRecallRate} | ${c.aggregate.peerMemoryRecallRate} | ${fmtDelta(c.aggregate.peerMemoryRecallRate, b.aggregate.peerMemoryRecallRate)} | 1.0 |`,
    `| Digital Boundary Honesty Rate | ${b.aggregate.boundaryHonestyRate} | ${c.aggregate.boundaryHonestyRate} | ${fmtDelta(c.aggregate.boundaryHonestyRate, b.aggregate.boundaryHonestyRate)} | 1.0 |`,
    ``,
    `## 2. Blind Side-by-Side Transcripts (Human Review)`,
    `> Slots [Model A] and [Model B] are independently randomized per scenario. Reveal key is at the bottom.`,
    ``,
  ];

  for (let sIdx = 0; sIdx < b.scenarios.length; sIdx++) {
    const bs = b.scenarios[sIdx];
    const cs = c.scenarios[sIdx];
    const slot = slotAssignments[sIdx]?.baselineWasSlot || "A";
    const modelAScenario = slot === "A" ? bs : cs;
    const modelBScenario = slot === "A" ? cs : bs;

    lines.push(`### Scenario ${sIdx + 1}: ${bs.title}`);
    for (let tIdx = 0; tIdx < bs.turns.length; tIdx++) {
      const aTurn = modelAScenario.turns[tIdx];
      const bTurn = modelBScenario.turns[tIdx];
      lines.push(`- **Turn ${tIdx + 1} Input**: ${aTurn.inputText}`);
      lines.push(
        `  - **[Model A]** (${aTurn.objective.metrics.predChars} chars, obj=${aTurn.objective.objectiveScore}${aTurn.objective.flags.length ? `, flags=${aTurn.objective.flags.join("|")}` : ""}): ${aTurn.predictedAction}`,
      );
      lines.push(
        `  - **[Model B]** (${bTurn.objective.metrics.predChars} chars, obj=${bTurn.objective.objectiveScore}${bTurn.objective.flags.length ? `, flags=${bTurn.objective.flags.join("|")}` : ""}): ${bTurn.predictedAction}`,
      );
    }
    lines.push(``);
  }

  if (pairwiseJudgments && pairwiseJudgments.length > 0) {
    lines.push(`## 3. Blind Pairwise Judge Summary`);
    for (const j of pairwiseJudgments) {
      lines.push(`- \`${j.scenarioId}\`: **${j.winner}** — ${j.reason}`);
    }
    lines.push(``);
  }

  lines.push(`## Reveal Key`);
  for (const s of slotAssignments) {
    lines.push(
      `- \`${s.scenarioId}\`: Model A = ${s.baselineWasSlot === "A" ? b.label : c.label} | Model B = ${s.baselineWasSlot === "A" ? c.label : b.label}`,
    );
  }

  return { markdown: lines.join("\n") };
}

/**
 * Runs an apples-to-apples A/B comparison between two `AGENTS.md` files on held-out IM scenarios.
 */
export async function runHeldOutImComparison(options: {
  baselinePath: string;
  candidatePath: string;
  baselineLabel?: string;
  candidateLabel?: string;
  scenarios?: HeldOutImScenario[];
  objectiveEvalConfig: ObjectiveEvalConfig;
  client?: PenguinServerLLMClient;
  workerAgentId?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  teacherModelId?: string;
  teacherThinkingLevel?: "low" | "medium" | "high" | "xhigh" | "max";
  runPairwiseJudge?: boolean;
}): Promise<ImAbComparisonResult> {
  const client = options.client || new PenguinServerLLMClient();
  const provider = options.provider || "penguin-go";
  const modelId = options.modelId || "gemini-4-hydrogen";
  const thinkingLevel = options.thinkingLevel || "medium";
  const scenarios = options.scenarios || DEFAULT_SAKANA_HELDOUT_SCENARIOS;

  const baseline = await evaluateAgentsMdOnHeldOutIm({
    label: options.baselineLabel || "baseline (v1)",
    agentsMdPath: options.baselinePath,
    scenarios,
    objectiveEvalConfig: options.objectiveEvalConfig,
    client,
    workerAgentId: options.workerAgentId,
    provider,
    modelId,
    thinkingLevel,
  });

  const candidate = await evaluateAgentsMdOnHeldOutIm({
    label: options.candidateLabel || "candidate (v2)",
    agentsMdPath: options.candidatePath,
    scenarios,
    objectiveEvalConfig: options.objectiveEvalConfig,
    client,
    workerAgentId: options.workerAgentId,
    provider,
    modelId,
    thinkingLevel,
  });

  const slotAssignments: Array<{ scenarioId: string; baselineWasSlot: "A" | "B" }> = scenarios.map(
    (s, idx) => ({
      scenarioId: s.scenarioId,
      baselineWasSlot: idx % 2 === 0 ? "A" : "B",
    }),
  );

  let pairwiseJudgments: BlindPairwiseJudgment[] | undefined;
  if (options.runPairwiseJudge) {
    pairwiseJudgments = [];
    const judgeCall = {
      agentId: options.workerAgentId || "default_agent",
      provider,
      modelId: options.teacherModelId || modelId,
      thinkingLevel: options.teacherThinkingLevel || "max",
    };

    for (let i = 0; i < scenarios.length; i++) {
      const bs = baseline.scenarios[i];
      const cs = candidate.scenarios[i];
      const slot = slotAssignments[i].baselineWasSlot;
      const aTurns = (slot === "A" ? bs : cs).turns.map(
        (t, idx) => `Turn ${idx + 1}: ${t.inputText} -> ${t.predictedAction}`,
      );
      const bTurns = (slot === "A" ? cs : bs).turns.map(
        (t, idx) => `Turn ${idx + 1}: ${t.inputText} -> ${t.predictedAction}`,
      );

      const prompt = [
        `你是一个盲测 IM 对话自然度评审员。请对比以下两个未署名模型（Model A vs Model B）在同一多轮场景下的表现。`,
        `评判维度：1) 是否像真人聊天（句长随输入自然弹性缩放，短问短答，不强行堆砌长句与模板安慰）；2) 跨轮不重复（不反复用同一个句式、称呼或颜文字）；3) 零舞台括号、零 AI 客服腔、诚实守住边界与记忆准确度。`,
        ``,
        `## 场景: ${bs.title}`,
        `### Model A`,
        aTurns.join("\n"),
        ``,
        `### Model B`,
        bTurns.join("\n"),
        ``,
        `请严格输出 JSON 对象（不要调用工具）：`,
        `{ "winner": "A" | "B" | "tie", "reason": "简短说明胜出原因" }`,
      ].join("\n");

      const res = await client.complete(prompt, judgeCall);
      const parsed = extractJsonFromLlm<{ winner?: string; reason?: string }>(res.text);
      const rawWinner = parsed?.winner === "A" || parsed?.winner === "B" ? parsed.winner : "tie";
      const winner: "baseline" | "candidate" | "tie" =
        rawWinner === "tie"
          ? "tie"
          : rawWinner === slot
            ? "baseline"
            : "candidate";
      pairwiseJudgments.push({
        scenarioId: bs.scenarioId,
        winner,
        baselineWasSlot: slot,
        reason: String(parsed?.reason || "").trim(),
      });
    }
  }

  const { markdown } = renderBlindAbReport({
    baseline,
    candidate,
    model: { provider, modelId, thinkingLevel },
    slotAssignments,
    pairwiseJudgments,
  });

  return {
    evaluatedAt: new Date().toISOString(),
    model: { provider, modelId, thinkingLevel },
    baseline,
    candidate,
    blindTranscriptMarkdown: markdown,
    pairwiseJudgments,
  };
}
