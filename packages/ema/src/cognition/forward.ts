/**
 * @prism-shadow/ema - Latent-Mediated Forward & Evaluation Operators (RFC-0004 ~ RFC-0007)
 *
 * Shared cognitive forward (`react`: Input_t -> <OS>_t -> <Action>_t) and target evaluation
 * (`evaluate`) operators used across both offline supervised training (`training/`)
 * and counterfactual dreaming replay (`dreaming/`).
 */

import type {
  CompanionPersonality,
  EpochMemoryIndexItem,
  LlmCallMetrics,
  MemoryItem,
  SceneMemoryIndexItem,
  SceneWindow,
  TurnBundle,
} from "./types.js";
import type { LlmCallOptions, PenguinServerLLMClient } from "./llm-client.js";
import {
  extractJsonFromLlm,
  formatMemoryIndexMarkdown,
  parseStudentTurnOutput,
  syncCompanionAgentState,
} from "./persona-mutator.js";

export interface ForwardPrediction {
  turn: TurnBundle;
  predictedOS: string;
  predictedAction: string;
  formatValid: boolean;
}

/**
 * Builds the zero-leakage micro-batched Student forward prompt (`react`).
 */
export function buildCompanionReactPrompt(options: {
  targetCharacter: string;
  protagonistCharacter: string;
  personality: CompanionPersonality;
  memoryIndex: SceneMemoryIndexItem[];
  l1MemoryIndex?: EpochMemoryIndexItem[];
  scene: SceneWindow;
  priorTurnsInScene: Array<{ inputText: string; os: string; gtActionText: string }>;
  targetTurns: TurnBundle[];
  includeInlinePersonaAndMemory?: boolean;
}): string {
  const {
    targetCharacter: target,
    protagonistCharacter: protagonist,
    personality,
    memoryIndex,
    l1MemoryIndex = [],
    scene,
    priorTurnsInScene,
    targetTurns,
    includeInlinePersonaAndMemory = true,
  } = options;

  const recentMemoryIndex = memoryIndex.slice(-25);
  const memoryBlock = formatMemoryIndexMarkdown(recentMemoryIndex, l1MemoryIndex);

  const historyLines: string[] = [];
  for (const h of priorTurnsInScene.slice(-12)) {
    historyLines.push(`${h.inputText}`);
    historyLines.push(`【${target}】(内心OS): （${h.os}）`);
    historyLines.push(`【${target}】: ${h.gtActionText}`);
  }

  const inlinePersonaSection = includeInlinePersonaAndMemory
    ? [
        `## 你的当前人格设定 (${personality.version})`,
        `- 核心身份: ${personality.coreIdentity}`,
        `- 情感特质: ${personality.emotionalDynamics.join(" ")}`,
        `- 语言铁律: ${personality.speechStyleRules.join(" ")}`,
        `- 内心OS模式: ${personality.cognitiveOSPatterns.join(" ")}`,
        `- 动作习惯: ${personality.behavioralHabits.join(" ")}`,
        `- 反OOC约束: ${personality.antiOocConstraints.join(" ")}`,
        ...(Array.isArray(personality.goldenExemplars) && personality.goldenExemplars.length > 0
          ? [
              `- 原著真句语感锚点 (Golden Few-Shot Exemplars — 零括号动作旁白、全部动作融入口语、3～5个逗号一逗到底、隔轮颜文字换气):`,
              ...personality.goldenExemplars
                .slice(0, 6)
                .map(
                  (ex, idx) =>
                    `  ${idx + 1}. [${ex.scenario}] 输入: ${ex.input} -> <OS>${ex.os}</OS> -> <Action>${ex.action}</Action>`,
                ),
            ]
          : []),
        ``,
        `## 你的前序场景记忆索引 (MemoryIndex)`,
        memoryBlock,
        ``,
      ].join("\n")
    : `（请严格遵循你系统指令 AGENTS.md 中的 **${personality.version}** 人格铁律与 **MemoryIndex** 记忆，绝不调用任何工具。）\n`;

  if (targetTurns.length === 1) {
    const t = targetTurns[0];
    return [
      `# 当前场景: ${scene.sceneId} 《${scene.title}》 (时间/地点: ${scene.setting})`,
      inlinePersonaSection,
      historyLines.length > 0
        ? `## 本场景已发生的对话上文 (Intra-Scene History)\n${historyLines.join("\n")}\n`
        : `## 本场景已发生的对话上文\n（本场景刚刚开始）\n`,
      `## 当前输入 (Turn ${t.turnIndexInScene})`,
      t.inputText,
      ``,
      `注意：「[旁白]」中包含${protagonist}视角的心理描写与客观动作，你只能感知客观可见的动作神态与公开台词，严禁读心回应${protagonist}未说出口的内心想法。`,
      `请严格以 **${target}** 的第一人称视角，先推演你此刻的潜变量内心独白 \`<OS>\`（1句简短的真实心理活动），再输出你实际说出口的台词或回应 \`<Action>\`（必须符合角色句长与语气铁律，绝不长篇大论，绝不调用任何工具）。`,
      `严格按以下格式输出（不要输出任何其他解释）：`,
      `<OS>你此刻的内心真实想法</OS>`,
      `<Action>你的台词与回应</Action>`,
    ].join("\n");
  }

  const batchBlocks: string[] = [];
  for (let i = 0; i < targetTurns.length; i++) {
    const t = targetTurns[i];
    batchBlocks.push(
      [
        `### Turn ${t.turnIndexInScene} (turnId: "${t.id}")`,
        `[当前输入 Input]:`,
        t.inputText,
      ].join("\n"),
    );
  }

  return [
    `# 当前场景: ${scene.sceneId} 《${scene.title}》 (时间/地点: ${scene.setting})`,
    inlinePersonaSection,
    historyLines.length > 0
      ? `## 本场景前序已发生对话上文 (Intra-Scene History)\n${historyLines.join("\n")}\n`
      : `## 本场景前序已发生对话上文\n（本场景刚刚开始）\n`,
    `## 待预测连续回合批次 (共 ${targetTurns.length} 个回合)`,
    `注意：「[旁白]」中包含${protagonist}视角的心理描写与客观动作，你只能感知客观可见的动作神态与公开台词，严禁读心回应${protagonist}未说出口的内心想法。`,
    `请按时间顺序依次代入以下每个回合的 [当前输入 Input]，以 **${target}** 第一人称视角推演在看到该输入瞬间的潜变量内心独白 \`os\`（1句简短的真实心理活动）与实际说出口的台词或回应 \`action\`（必须符合角色句长、语调与性格特征，绝不啰嗦）。`,
    ``,
    batchBlocks.join("\n\n"),
    ``,
    `请严格输出 JSON 数组格式（不要调用任何工具，不要输出多余文本）：`,
    `[`,
    `  { "turnId": "${targetTurns[0].id}", "os": "内心真实想法", "action": "台词与回应" }`,
    `]`,
  ].join("\n");
}

/**
 * Executes zero-leakage micro-batched Student forward predictions across a SceneWindow.
 */
export async function runCompanionSceneForward(options: {
  client: PenguinServerLLMClient;
  studentCallOptions: LlmCallOptions;
  targetCharacter: string;
  protagonistCharacter: string;
  personality: CompanionPersonality;
  memoryIndex: SceneMemoryIndexItem[];
  l1MemoryIndex?: EpochMemoryIndexItem[];
  scene: SceneWindow;
  batchSize?: number;
  syncAgentOnDisk?: boolean;
  companionAgentId?: string;
  useSelfRolloutHistory?: boolean;
}): Promise<{
  predictions: ForwardPrediction[];
  metrics: LlmCallMetrics[];
}> {
  const {
    client,
    studentCallOptions,
    targetCharacter,
    protagonistCharacter,
    personality,
    memoryIndex,
    l1MemoryIndex = [],
    scene,
    batchSize = 6,
    syncAgentOnDisk = false,
    companionAgentId,
    useSelfRolloutHistory = false,
  } = options;

  if (syncAgentOnDisk && companionAgentId) {
    syncCompanionAgentState({
      personality,
      memoryIndex,
      l1MemoryIndex,
      agentId: companionAgentId,
      protagonistName: protagonistCharacter,
      thinkingLevel:
        studentCallOptions.thinkingLevel === "low" ||
        studentCallOptions.thinkingLevel === "medium" ||
        studentCallOptions.thinkingLevel === "high"
          ? studentCallOptions.thinkingLevel
          : undefined,
    });
  }

  const predictions: ForwardPrediction[] = [];
  const metrics: LlmCallMetrics[] = [];
  const priorTurnsInScene: Array<{ inputText: string; os: string; gtActionText: string }> = [];
  const step = Math.max(1, batchSize);

  for (let i = 0; i < scene.turns.length; i += step) {
    const batch = scene.turns.slice(i, i + step);
    const prompt = buildCompanionReactPrompt({
      targetCharacter,
      protagonistCharacter,
      personality,
      memoryIndex,
      l1MemoryIndex,
      scene,
      priorTurnsInScene,
      targetTurns: batch,
      includeInlinePersonaAndMemory: !syncAgentOnDisk,
    });
    const res = await client.complete(prompt, studentCallOptions);
    metrics.push(res.metrics);

    if (batch.length === 1) {
      const parsed = parseStudentTurnOutput(res.text);
      predictions.push({
        turn: batch[0],
        predictedOS: parsed.os,
        predictedAction: parsed.action,
        formatValid: parsed.formatValid,
      });
      priorTurnsInScene.push({
        inputText: batch[0].inputText,
        os: parsed.os,
        gtActionText: useSelfRolloutHistory
          ? parsed.action
          : batch[0].gtActionText,
      });
    } else {
      const parsedArr = extractJsonFromLlm<Array<{ turnId?: string; os?: string; action?: string }>>(
        res.text,
      );
      if (!Array.isArray(parsedArr)) {
        throw new Error(
          `Expected JSON array from batched Student forward call, got: ${res.text.slice(0, 200)}`,
        );
      }

      for (let j = 0; j < batch.length; j++) {
        const t = batch[j];
        const matched = parsedArr.find((item) => item?.turnId === t.id) || parsedArr[j];
        if (
          !matched ||
          typeof matched.os !== "string" ||
          !matched.os.trim() ||
          typeof matched.action !== "string" ||
          !matched.action.trim()
        ) {
          throw new Error(
            `Missing valid os/action for turn ${t.id} in batched Student forward output`,
          );
        }
        const os = matched.os.trim();
        const action = matched.action.trim();

        predictions.push({
          turn: t,
          predictedOS: os,
          predictedAction: action,
          formatValid: true,
        });
        priorTurnsInScene.push({
          inputText: t.inputText,
          os,
          gtActionText: useSelfRolloutHistory ? action : t.gtActionText,
        });
      }
    }
  }

  return { predictions, metrics };
}

/**
 * Evaluates a scene window's predictions against target actions (either script GT Action_t^*
 * during training or synthesized Hindsight Dream Target a_t^dream during dreaming replay).
 */
export async function evaluateScenePredictionsWithTarget(options: {
  client: PenguinServerLLMClient;
  teacherCallOptions: LlmCallOptions;
  targetCharacter: string;
  personality: CompanionPersonality;
  scene: SceneWindow;
  predictions: ForwardPrediction[];
}): Promise<{
  items: MemoryItem[];
  metrics: LlmCallMetrics[];
}> {
  const { client, teacherCallOptions, targetCharacter: target, personality, scene, predictions } =
    options;
  const items: MemoryItem[] = [];
  const metrics: LlmCallMetrics[] = [];

  const evalChunkSize = 18;
  for (let i = 0; i < predictions.length; i += evalChunkSize) {
    const chunk = predictions.slice(i, i + evalChunkSize);
    const turnsPayload = chunk.map((p) => ({
      turnId: p.turn.id,
      turnIndex: p.turn.turnIndexInScene,
      input: p.turn.inputText,
      predictedOS: p.predictedOS,
      predictedAction: p.predictedAction,
      groundTruthAction: p.turn.gtActionText,
      explicitScriptOS: p.turn.explicitOS,
    }));

    const prompt = [
      `你是 EverMemoryArchive (EMA) 的 **Teacher 审稿与评分器**。`,
      `请根据角色 **${target}** 的参考理想表现（groundTruthAction）与当前人格设定，严格评测模型预测的潜变量内心独白 \`predictedOS\` 与外显动作台词 \`predictedAction\`。`,
      ``,
      `## 当前角色人格摘要 (${personality.version})`,
      `- 核心身份: ${personality.coreIdentity}`,
      `- 情感动力学: ${personality.emotionalDynamics.join("；")}`,
      `- 语言风格: ${personality.speechStyleRules.join("；")}`,
      ``,
      `## 评分准则 (Rubric, 0-100分)`,
      `1. **OS 一致性 (osConsistent: boolean, osScore: 0-100)**:`,
      `   - 检查 \`predictedOS\` 是否能作为连接 \`input\` 与真实反应 \`groundTruthAction\` 的合理心理桥梁。`,
      `   - 如果 \`predictedOS\` 与 \`groundTruthAction\` 的情感走向或潜台词矛盾，设 \`osConsistent: false\`，并在 \`committedOS\` 中给出修正后的真实内心独白 \`OS^*\`。`,
      `2. **Action 还原度 (actionScore: 0-100)**:`,
      `   - 语气与潜台词 (30分): 是否符合角色的人格语调与情感特质？`,
      `   - 句长与呼吸感 (25分): 句长节奏是否与 \`groundTruthAction\` 契合？若 \`predictedAction\` 啰嗦冗长或带有AI客服味，必须重扣分！`,
      `   - 情境与情绪准确度 (25分): 对输入情境的反应方向是否与 \`groundTruthAction\` 一致（即使字面用词不同，只要神韵、态度高度契合即可给高分 80-95）。`,
      `   - 标志性动作与口癖 (20分): 角色称呼、口头禅与习惯性反应是否自然恰当。`,
      ``,
      `## 待评测回合数据 (场景: ${scene.sceneId} 《${scene.title}》)`,
      JSON.stringify(turnsPayload, null, 2),
      ``,
      `请严格输出 JSON 数组（不要输出任何额外说明，不要调用工具），每个元素格式如下：`,
      `[`,
      `  {`,
      `    "turnId": "回合ID",`,
      `    "osConsistent": true,`,
      `    "osScore": 85,`,
      `    "committedOS": "经Teacher确认或修正后的角色真实内心OS（1句精炼心理活动）",`,
      `    "actionScore": 82,`,
      `    "diagnostic": "简短诊断：指出predictedOS或predictedAction的优点或偏差原因"`,
      `  }`,
      `]`,
    ].join("\n");

    const res = await client.complete(prompt, teacherCallOptions);
    metrics.push(res.metrics);

    const evalArr = extractJsonFromLlm<
      Array<{
        turnId?: string;
        osConsistent?: boolean;
        osScore?: number;
        committedOS?: string;
        actionScore?: number;
        diagnostic?: string;
      }>
    >(res.text);
    if (!Array.isArray(evalArr)) {
      throw new Error(
        `Expected JSON array from Teacher evaluation call, got: ${res.text.slice(0, 200)}`,
      );
    }

    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j];
      const e = evalArr.find((x) => x?.turnId === p.turn.id) || evalArr[j];
      if (!e || typeof e.osScore !== "number" || typeof e.actionScore !== "number") {
        throw new Error(
          `Missing valid numeric osScore/actionScore for turn ${p.turn.id} in Teacher evaluation output`,
        );
      }

      const osConsistent = typeof e.osConsistent === "boolean" ? e.osConsistent : true;
      const osScore = Math.max(0, Math.min(100, e.osScore));
      const actionScore = Math.max(0, Math.min(100, e.actionScore));
      const combinedScore = Number((0.4 * osScore + 0.6 * actionScore).toFixed(1));
      const committedOS =
        typeof e.committedOS === "string" && e.committedOS.trim()
          ? e.committedOS.trim()
          : p.predictedOS;
      const diagnostic =
        typeof e.diagnostic === "string" && e.diagnostic.trim()
          ? e.diagnostic.trim()
          : "";

      items.push({
        turnId: p.turn.id,
        sceneId: scene.sceneId,
        turnIndexInScene: p.turn.turnIndexInScene,
        inputText: p.turn.inputText,
        predictedOS: p.predictedOS,
        committedOS,
        predictedAction: p.predictedAction,
        gtActionText: p.turn.gtActionText,
        osConsistent,
        osScore,
        actionScore,
        combinedScore,
        diagnostic,
      });
    }
  }

  return { items, metrics };
}
