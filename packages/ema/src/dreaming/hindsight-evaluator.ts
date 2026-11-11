/**
 * @prism-shadow/ema - Hindsight Self-Supervised Evaluator & Target Synthesizer (RFC-0007)
 *
 * During live companion interaction, there is no external Galgame script Ground Truth `a_t^*`.
 * During `dreaming`, the Teacher model inspects completed daytime interaction windows with
 * full hindsight (`Input_{t+1..t+k}`) and `anchorPersonality` invariants to:
 * 1. Score observed `<OS_t, Action_t>` for persona fidelity and user resonance
 * 2. Detect subtle OOC drift (length inflation, assistant-speak, lost habits)
 * 3. Synthesize counterfactual ideal targets `<OS_t^*, a_t^dream>` so counterfactual replay
 *    can run the exact same forward-backward RSI verification loop as offline `train`.
 */

import type {
  CompanionPersonality,
  HindsightTurnEvaluation,
  LlmCallMetrics,
  MemoryItem,
  SceneWindow,
  TurnBundle,
} from "../cognition/types.js";
import type { LlmCallOptions, PenguinServerLLMClient } from "../cognition/llm-client.js";
import { extractJsonFromLlm } from "../cognition/persona-mutator.js";

export async function evaluateSceneInHindsight(options: {
  client: PenguinServerLLMClient;
  teacherCallOptions: LlmCallOptions;
  targetCharacter: string;
  protagonistCharacter: string;
  currentPersonality: CompanionPersonality;
  anchorPersonality: CompanionPersonality;
  sceneId: string;
  sceneTitle: string;
  sceneSetting: string;
  items: MemoryItem[];
}): Promise<{
  evaluations: HindsightTurnEvaluation[];
  calibratedItems: MemoryItem[];
  counterfactualScene: SceneWindow;
  metrics: LlmCallMetrics[];
}> {
  const {
    client,
    teacherCallOptions,
    targetCharacter: target,
    protagonistCharacter: protagonist,
    currentPersonality,
    anchorPersonality,
    sceneId,
    sceneTitle,
    sceneSetting,
    items,
  } = options;

  const evaluations: HindsightTurnEvaluation[] = [];
  const calibratedItems: MemoryItem[] = [];
  const counterfactualTurns: TurnBundle[] = [];
  const metrics: LlmCallMetrics[] = [];

  const chunkSize = 12;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const payload = chunk.map((it, idx) => {
      const globalIdx = i + idx;
      const nextItem = items[globalIdx + 1];
      return {
        turnId: it.turnId,
        turnIndex: it.turnIndexInScene,
        input: it.inputText,
        observedOS: it.committedOS || it.predictedOS,
        observedAction: it.gtActionText || it.predictedAction,
        subsequentUserReaction: nextItem
          ? nextItem.inputText
          : "（本段对话自然告一段落，对方安静倾听或满意离开）",
      };
    });

    const prompt = [
      `你是 EverMemoryArchive (EMA) 梦境自省引擎（RFC-0007 Dreaming Engine）的 **事后自省评估器 (Hindsight Evaluator)**。`,
      `当前伴侣角色「${target}」正在睡眠/后台梦境中回顾她与「${protagonist}」（及群友）在场景 \`${sceneId}\` 《${sceneTitle}》(${sceneSetting}) 中的真实对话记录。`,
      `每个回合中，「${target}」都显式输出了潜变量内心独白 \`<OS>\` (\`observedOS\`) 与外显动作台词 \`<Action>\` (\`observedAction\`)。`,
      `与离线剧本训练不同，真实对话没有预设剧本标准答案。请你结合：`,
      `1. **事后用户反馈 (subsequentUserReaction)**：观察「${target}」发出 \`observedAction\` 后，对方在下一轮的反应是温暖共鸣、自然延续，还是困惑、纠正或冷场；`,
      `2. **锚点人格法则 (Anchor Personality Invariants)**：同时检查内心独白 \`observedOS\`（是否符合第一人称性格逻辑与非读心视角边界）与外显回复 \`observedAction\`（是否出现了回复冗长说教、AI 客服套话、记忆事实错误、或丢失了「${target}」温柔细腻的神态语气）。`,
      ``,
      `## 核心锚点人格 (${anchorPersonality.version}) 与当前人格 (${currentPersonality.version})`,
      `- 核心身份: ${anchorPersonality.coreIdentity}`,
      `- 情感动力学: ${currentPersonality.emotionalDynamics.join("；")}`,
      `- 语言风格铁律: ${currentPersonality.speechStyleRules.join("；")}`,
      `- 反 OOC 约束: ${currentPersonality.antiOocConstraints.join("；")}`,
      ``,
      `## 待回顾的日间真实交互轨迹`,
      JSON.stringify(payload, null, 2),
      ``,
      `请对每个回合进行事后评估，并合成反事实理想目标（\`synthesizedDreamOS\` 与 \`synthesizedDreamAction\`）：`,
      `- 如果该回合原本表现极佳（>= 85分，无漂移），\`synthesizedDreamAction\` 可保持原回复或做微小润色；`,
      `- 如果该回合存在人设漂移、句长失控或未接住对方情绪（driftDetected: true），请在 \`synthesizedDreamAction\` 中写出「如果重来一次，最契合 ${target} 人格与对方心意的理想回复」。`,
      ``,
      `请严格输出 JSON 数组（不要调用任何工具，不要输出多余文字）：`,
      `[`,
      `  {`,
      `    "turnId": "回合ID",`,
      `    "osScore": 86,`,
      `    "actionScore": 84,`,
      `    "driftDetected": false,`,
      `    "diagnostic": "简短自省诊断：指出本回合的情感共鸣亮点或人设漂移之处",`,
      `    "synthesizedDreamOS": "校准后的第一人称精炼内心独白 OS_t^*",`,
      `    "synthesizedDreamAction": "反事实理想回复 a_t^dream"`,
      `  }`,
      `]`,
    ].join("\n");

    const res = await client.complete(prompt, teacherCallOptions);
    metrics.push(res.metrics);

    const parsedArr = extractJsonFromLlm<
      Array<{
        turnId?: string;
        osScore?: number;
        actionScore?: number;
        driftDetected?: boolean;
        diagnostic?: string;
        synthesizedDreamOS?: string;
        synthesizedDreamAction?: string;
      }>
    >(res.text);
    if (!Array.isArray(parsedArr)) {
      throw new Error(
        `Expected JSON array from Hindsight Dream Evaluator, got: ${res.text.slice(0, 200)}`,
      );
    }

    for (let j = 0; j < chunk.length; j++) {
      const it = chunk[j];
      const p = payload[j];
      const e = parsedArr.find((x) => x?.turnId === it.turnId) || parsedArr[j];
      if (!e || typeof e.osScore !== "number" || typeof e.actionScore !== "number") {
        throw new Error(
          `Missing valid numeric osScore/actionScore for turn ${it.turnId} in Hindsight Dream Evaluator output`,
        );
      }

      const osScore = Math.max(0, Math.min(100, e.osScore));
      const actionScore = Math.max(0, Math.min(100, e.actionScore));
      const combinedScore = Number((0.4 * osScore + 0.6 * actionScore).toFixed(1));
      const driftDetected =
        typeof e.driftDetected === "boolean" ? e.driftDetected : combinedScore < 76;
      const diagnostic =
        typeof e.diagnostic === "string" && e.diagnostic.trim()
          ? e.diagnostic.trim()
          : "";
      const synthesizedDreamOS =
        typeof e.synthesizedDreamOS === "string" && e.synthesizedDreamOS.trim()
          ? e.synthesizedDreamOS.trim()
          : it.committedOS || it.predictedOS;
      const synthesizedDreamAction =
        typeof e.synthesizedDreamAction === "string" && e.synthesizedDreamAction.trim()
          ? e.synthesizedDreamAction.trim()
          : it.gtActionText || it.predictedAction;

      evaluations.push({
        turnId: it.turnId,
        sceneId,
        turnIndexInScene: it.turnIndexInScene,
        inputText: it.inputText,
        observedOS: p.observedOS,
        observedAction: p.observedAction,
        subsequentUserReaction: p.subsequentUserReaction,
        osScore,
        actionScore,
        combinedScore,
        driftDetected,
        diagnostic,
        synthesizedDreamOS,
        synthesizedDreamAction,
      });

      calibratedItems.push({
        turnId: it.turnId,
        sceneId,
        turnIndexInScene: it.turnIndexInScene,
        inputText: it.inputText,
        predictedOS: p.observedOS,
        committedOS: synthesizedDreamOS,
        predictedAction: p.observedAction,
        gtActionText: synthesizedDreamAction,
        osConsistent: !driftDetected,
        osScore,
        actionScore,
        combinedScore,
        diagnostic,
      });

      counterfactualTurns.push({
        id: it.turnId,
        sceneId,
        turnIndexInScene: it.turnIndexInScene,
        globalTurnIndex: i + j + 1,
        inputLines: [],
        inputText: it.inputText,
        gtActionLines: [],
        gtActionText: synthesizedDreamAction,
        explicitOS: synthesizedDreamOS,
      });
    }
  }

  const counterfactualScene: SceneWindow = {
    sceneId,
    order: 1,
    chapter: "梦境自省重放",
    title: sceneTitle,
    setting: sceneSetting,
    isHScene: false,
    characters: [target, protagonist],
    rawLineCount: counterfactualTurns.length * 2,
    turns: counterfactualTurns,
    trailingLines: [],
    trailingText: "",
  };

  return {
    evaluations,
    calibratedItems,
    counterfactualScene,
    metrics,
  };
}
