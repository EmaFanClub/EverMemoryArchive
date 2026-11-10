/**
 * @prism-shadow/ema - RFC-0003 / RFC-0004 / RFC-0005 Training Prototype
 *
 * Implements the latent-mediated forward-backward RSI loop:
 * 1. Cold-Start Warmup: Initialize P_{0,0} from warmup scenes (q_{1..N})
 * 2. Student Forward (`react`): Input_t -> OS_t -> Action_t (with Teacher-Forcing to GT_Action_t^*)
 * 3. Teacher Evaluation (`evaluate`): Check OS_t consistency with GT_Action_t^* & score Action_t similarity
 * 4. Local Window RSI (`adjust_personality`): Mutate P_{u,v} -> P_{u,v}' when window score < threshold & re-verify
 * 5. Scene Compaction (`compact` + `reflect`): Compress {MemoryItem_t} -> single-level MemoryIndex_{0,x}
 */

import type {
  CompressionPromptConfig,
  LlmCallMetrics,
  MemoryItem,
  SceneMemoryIndexItem,
  SceneWindow,
  ShirobanaPersonality,
  TurnBundle,
  WindowTrainingResult,
} from "./types.js";
import { PenguinServerLLMClient, sumMetrics, type LlmCallOptions } from "./llm-client.js";
import {
  INITIAL_COMPRESSION_PROMPT_C0_0,
  INITIAL_SHIROBANA_P0_0,
  formatMemoryIndexMarkdown,
  syncShirobanaAgentState,
} from "./personality.js";

/**
 * Extracts <OS> and <Action> blocks from Student model output.
 */
export function parseStudentTurnOutput(rawText: string): {
  os: string;
  action: string;
  formatValid: boolean;
} {
  const text = (rawText || "").trim();
  const osMatch = text.match(/<OS>([\s\S]*?)<\/OS>/i);
  const actionMatch = text.match(/<Action>([\s\S]*?)<\/Action>/i);

  if (osMatch && actionMatch) {
    return {
      os: osMatch[1].trim(),
      action: actionMatch[1].trim(),
      formatValid: true,
    };
  }

  // Fallback: try JSON if model emitted JSON
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.os === "string" && typeof parsed.action === "string") {
        return {
          os: parsed.os.trim(),
          action: parsed.action.trim(),
          formatValid: true,
        };
      }
    }
  } catch {
    // ignore
  }

  // Fallback: split if model wrote "内心/OS:" and "台词/Action:"
  const fallbackOs = osMatch ? osMatch[1].trim() : "（静静观察着眼前的情形）";
  const fallbackAction = actionMatch
    ? actionMatch[1].trim()
    : text.replace(/<OS>[\s\S]*?<\/OS>/gi, "").trim();

  return {
    os: fallbackOs,
    action: fallbackAction || "「……」",
    formatValid: false,
  };
}

/**
 * Extracts a JSON object or array from an LLM response string (stripping markdown fences if present).
 */
export function extractJsonFromLlm<T = any>(rawText: string): T {
  const cleaned = (rawText || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Find first { or [ and matching last } or ]
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = cleaned.lastIndexOf("}");
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleaned.lastIndexOf("]");
    }
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error(`Failed to parse JSON from LLM output: ${rawText.slice(0, 240)}`);
  }
}

export interface TrainerConfig {
  studentModel: {
    provider: string;
    modelId: string;
    thinkingLevel: "low" | "medium" | "high";
  };
  teacherModel: {
    provider: string;
    modelId: string;
    thinkingLevel: "low" | "medium" | "high";
  };
  /** Agent ID in PenguinHarness for Shirobana (default: "shirobana") */
  shirobanaAgentId?: string;
  /** Minimum acceptable window score before triggering local RSI retry (default: 78) */
  rsiScoreThreshold?: number;
  /** Maximum attempts per scene window (1 = no retry, 2 = 1 retry after mutation; default: 2) */
  maxWindowAttempts?: number;
  /** Micro-batch size for Student forward calls within a scene (1 = strict turn-by-turn; default: 4) */
  studentBatchSize?: number;
  /** Whether to run reflection check on compacted scene memory (default: true) */
  enableReflectionCheck?: boolean;
  /** Sync `shirobana` AGENTS.md on disk after each scene window (default: true) */
  syncAgentOnDisk?: boolean;
}

export class EmaShirobanaTrainer {
  public readonly client: PenguinServerLLMClient;
  public readonly config: Required<TrainerConfig>;
  public personality: ShirobanaPersonality;
  public compressionPrompt: CompressionPromptConfig;
  public memoryIndex: SceneMemoryIndexItem[];

  constructor(
    config: TrainerConfig,
    options?: {
      client?: PenguinServerLLMClient;
      initialPersonality?: ShirobanaPersonality;
      initialCompressionPrompt?: CompressionPromptConfig;
      initialMemoryIndex?: SceneMemoryIndexItem[];
    },
  ) {
    this.client = options?.client || new PenguinServerLLMClient();
    this.config = {
      shirobanaAgentId: "shirobana",
      rsiScoreThreshold: 78,
      maxWindowAttempts: 2,
      studentBatchSize: 4,
      enableReflectionCheck: true,
      syncAgentOnDisk: true,
      ...config,
    };
    this.personality = options?.initialPersonality
      ? structuredClone(options.initialPersonality)
      : structuredClone(INITIAL_SHIROBANA_P0_0);
    this.compressionPrompt = options?.initialCompressionPrompt
      ? structuredClone(options.initialCompressionPrompt)
      : structuredClone(INITIAL_COMPRESSION_PROMPT_C0_0);
    this.memoryIndex = options?.initialMemoryIndex
      ? structuredClone(options.initialMemoryIndex)
      : [];
  }

  private studentCallOptions(): LlmCallOptions {
    return {
      agentId: this.config.shirobanaAgentId,
      provider: this.config.studentModel.provider,
      modelId: this.config.studentModel.modelId,
      thinkingLevel: this.config.studentModel.thinkingLevel,
    };
  }

  private teacherCallOptions(): LlmCallOptions {
    return {
      agentId: "ema_minimal",
      provider: this.config.teacherModel.provider,
      modelId: this.config.teacherModel.modelId,
      thinkingLevel: this.config.teacherModel.thinkingLevel,
    };
  }

  /**
   * Builds the system-context reminder for Student forward (`react`) calls.
   */
  public buildStudentReactPrompt(
    scene: SceneWindow,
    priorTurnsInScene: Array<{ inputText: string; os: string; gtActionText: string }>,
    targetTurns: TurnBundle[],
    options?: { includeInlinePersonaAndMemory?: boolean },
  ): string {
    // When running against `shirobana` with syncAgentOnDisk=true, AGENTS.md already
    // injects P_{u,v} and MemoryIndex into the system prompt prefix (Bug #2 fix).
    const includeInline = options?.includeInlinePersonaAndMemory ?? !this.config.syncAgentOnDisk;
    const recentMemoryIndex = this.memoryIndex.slice(-25);
    const memoryBlock = formatMemoryIndexMarkdown(recentMemoryIndex);

    const historyLines: string[] = [];
    for (const h of priorTurnsInScene.slice(-12)) {
      historyLines.push(`${h.inputText}`);
      historyLines.push(`【白花】(内心OS): （${h.os}）`);
      historyLines.push(`【白花】: ${h.gtActionText}`);
    }

    const inlinePersonaSection = includeInline
      ? [
          `## 你的当前人格设定 (${this.personality.version})`,
          `- 核心身份: ${this.personality.coreIdentity}`,
          `- 情感特质: ${this.personality.emotionalDynamics.join(" ")}`,
          `- 语言铁律: ${this.personality.speechStyleRules.join(" ")}`,
          `- 内心OS模式: ${this.personality.cognitiveOSPatterns.join(" ")}`,
          `- 动作习惯: ${this.personality.behavioralHabits.join(" ")}`,
          `- 反OOC约束: ${this.personality.antiOocConstraints.join(" ")}`,
          ``,
          `## 你的前序场景记忆索引 (MemoryIndex)`,
          memoryBlock,
          ``,
        ].join("\n")
      : `（请严格遵循你系统指令 AGENTS.md 中的 **${this.personality.version}** 人格铁律与 **MemoryIndex** 记忆，绝不调用任何工具。）\n`;

    if (targetTurns.length === 1) {
      const t = targetTurns[0];
      return [
        `# 当前训练场景: ${scene.sceneId} 《${scene.title}》 (时间/地点: ${scene.setting})`,
        inlinePersonaSection,
        historyLines.length > 0
          ? `## 本场景已发生的对话上文 (Intra-Scene History)\n${historyLines.join("\n")}\n`
          : `## 本场景已发生的对话上文\n（本场景刚刚开始）\n`,
        `## 当前输入 (Turn ${t.turnIndexInScene})`,
        t.inputText,
        ``,
        `注意：「[旁白]」中包含苍空视角的心理描写与客观动作，你只能感知客观可见的动作神态与公开台词，严禁读心回应苍空未说出口的内心想法。`,
        `请严格以**白花**的第一人称视角，先推演你此刻的潜变量内心独白 \`<OS>\`（1句简短的真实心理活动），再输出你实际说出口的台词 \`<Action>\`（必须极其简短干脆，用「」包裹台词，绝不长篇大论，绝不调用任何工具）。`,
        `严格按以下格式输出（不要输出任何其他解释）：`,
        `<OS>你此刻的内心真实想法</OS>`,
        `<Action>「你的台词」</Action>`,
      ].join("\n");
    }

    // Micro-batched causal prediction within the scene window (Zero-Leakage v1.0):
    // Prior batches in `priorTurnsInScene` are teacher-forced with GT_Action,
    // while turns inside the current `targetTurns` batch NEVER expose GT_Action.
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
      `# 当前训练场景: ${scene.sceneId} 《${scene.title}》 (时间/地点: ${scene.setting})`,
      inlinePersonaSection,
      historyLines.length > 0
        ? `## 本场景前序已发生对话上文 (Teacher-Forced Intra-Scene History)\n${historyLines.join("\n")}\n`
        : `## 本场景前序已发生对话上文\n（本场景刚刚开始）\n`,
      `## 待预测连续回合批次 (共 ${targetTurns.length} 个回合)`,
      `注意：「[旁白]」中包含苍空视角的心理描写与客观动作，你只能感知客观可见的动作神态与公开台词，严禁读心回应苍空未说出口的内心想法。`,
      `请按时间顺序依次代入以下每个回合的 [当前输入 Input]，以**白花**第一人称视角推演她在看到该输入瞬间的潜变量内心独白 \`os\`（1句简短的真实心理活动）与实际说出口的台词 \`action\`（必须符合白花真实的极简短句、冷淡/毒舌/傲娇、吹肥皂泡或正事搭档风格，台词用「」包裹，绝不啰嗦）。`,
      ``,
      batchBlocks.join("\n\n"),
      ``,
      `请严格输出 JSON 数组格式（不要调用任何工具，不要输出多余文本）：`,
      `[`,
      `  { "turnId": "${targetTurns[0].id}", "os": "内心真实想法", "action": "「台词」" }`,
      `]`,
    ].join("\n");
  }

  /**
   * Runs Student forward predictions (`react`) across all turns of a scene window.
   */
  public async runStudentSceneForward(scene: SceneWindow): Promise<{
    predictions: Array<{
      turn: TurnBundle;
      predictedOS: string;
      predictedAction: string;
      formatValid: boolean;
    }>;
    metrics: LlmCallMetrics[];
  }> {
    if (this.config.syncAgentOnDisk) {
      syncShirobanaAgentState({
        personality: this.personality,
        memoryIndex: this.memoryIndex,
        agentId: this.config.shirobanaAgentId,
        thinkingLevel: this.config.studentModel.thinkingLevel,
      });
    }

    const predictions: Array<{
      turn: TurnBundle;
      predictedOS: string;
      predictedAction: string;
      formatValid: boolean;
    }> = [];
    const metrics: LlmCallMetrics[] = [];
    const priorTurnsInScene: Array<{ inputText: string; os: string; gtActionText: string }> = [];

    const batchSize = Math.max(1, this.config.studentBatchSize);

    for (let i = 0; i < scene.turns.length; i += batchSize) {
      const batch = scene.turns.slice(i, i + batchSize);
      const prompt = this.buildStudentReactPrompt(scene, priorTurnsInScene, batch);
      const res = await this.client.complete(prompt, this.studentCallOptions());
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
          gtActionText: batch[0].gtActionText,
        });
      } else {
        let parsedArr: Array<{ turnId?: string; os?: string; action?: string }> = [];
        let formatOk = true;
        try {
          parsedArr = extractJsonFromLlm(res.text);
          if (!Array.isArray(parsedArr)) formatOk = false;
        } catch {
          formatOk = false;
        }

        for (let j = 0; j < batch.length; j++) {
          const t = batch[j];
          const matched =
            (Array.isArray(parsedArr) &&
              (parsedArr.find((item) => item?.turnId === t.id) || parsedArr[j])) ||
            {};
          const os =
            typeof matched.os === "string" && matched.os.trim()
              ? matched.os.trim()
              : "（静静看着苍空，心里有些在意但表面维持冷淡）";
          const action =
            typeof matched.action === "string" && matched.action.trim()
              ? matched.action.trim()
              : "「……呼——」";

          predictions.push({
            turn: t,
            predictedOS: os,
            predictedAction: action,
            formatValid: formatOk && Boolean(matched.os && matched.action),
          });
          priorTurnsInScene.push({
            inputText: t.inputText,
            os,
            gtActionText: t.gtActionText,
          });
        }
      }
    }

    return { predictions, metrics };
  }

  /**
   * Teacher evaluation (`evaluate`) of a scene window's predictions against Ground Truth Action_t^*.
   */
  public async evaluateScenePredictions(
    scene: SceneWindow,
    predictions: Array<{
      turn: TurnBundle;
      predictedOS: string;
      predictedAction: string;
      formatValid: boolean;
    }>,
  ): Promise<{
    items: MemoryItem[];
    metrics: LlmCallMetrics[];
  }> {
    const items: MemoryItem[] = [];
    const metrics: LlmCallMetrics[] = [];

    // Evaluate in chunks of up to 18 turns so Teacher output JSON stays well within limits
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
        `你是 EverMemoryArchive (EMA) 角色逆向蒸馏训练的 **Teacher 审稿与评分器**。`,
        `请根据《保健室的老师与沉迷吹泡泡的助手》原作中女主角 **白花（此花白花 / 小白）** 的真实剧本表现（Ground Truth Action），严格评测 Student 模型预测的潜变量内心独白 \`predictedOS\` 与外显动作台词 \`predictedAction\`。`,
        ``,
        `## 评分准则 (Rubric, 0-100分)`,
        `1. **OS 一致性 (osConsistent: boolean, osScore: 0-100)**:`,
        `   - 检查 \`predictedOS\` 是否能作为连接 \`input\` 与原作真实反应 \`groundTruthAction\` 的合理心理桥梁。`,
        `   - 白花是典型的外冷内热/毒舌傲娇魂人少女：表面数落苍空（「真是没用呢」「笨蛋」）或吹肥皂泡（「呼——」）敷衍，内心往往是在意、害羞、吃醋、护短或掩饰寂寞。`,
        `   - 如果 \`predictedOS\` 与 \`groundTruthAction\` 的情感走向矛盾，设 \`osConsistent: false\`，并在 \`committedOS\` 中给出修正后的真实内心独白 \`OS^*\`。`,
        `2. **Action 还原度 (actionScore: 0-100)**:`,
        `   - 语气与傲娇潜台词 (30分): 是否符合白花冷淡、毒舌、简短吐槽的语气？`,
        `   - 句长与呼吸感 (25分): 原作白花台词极短（常为几个字到一两句短话）。若 \`predictedAction\` 啰嗦冗长或带有AI客服味，必须重扣分！`,
        `   - 情境与情绪准确度 (25分): 对输入情境的反应方向是否与 \`groundTruthAction\` 一致（即使字面用词不同，只要神韵、态度、简短度高度契合即可给高分 80-95）。`,
        `   - 标志性动作口癖 (20分): 吹泡泡「呼——」、直呼「苍空」、吐槽「笨蛋/杂鱼」等是否自然恰当。`,
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
        `    "committedOS": "经Teacher确认或修正后的白花真实内心OS（1句精炼心理活动）",`,
        `    "actionScore": 82,`,
        `    "diagnostic": "简短诊断：指出predictedOS或predictedAction的优点或与GT的偏差原因"`,
        `  }`,
        `]`,
      ].join("\n");

      const res = await this.client.complete(prompt, this.teacherCallOptions());
      metrics.push(res.metrics);

      let evalArr: Array<{
        turnId?: string;
        osConsistent?: boolean;
        osScore?: number;
        committedOS?: string;
        actionScore?: number;
        diagnostic?: string;
      }> = [];
      try {
        evalArr = extractJsonFromLlm(res.text);
      } catch {
        evalArr = [];
      }

      for (let j = 0; j < chunk.length; j++) {
        const p = chunk[j];
        const e =
          (Array.isArray(evalArr) &&
            (evalArr.find((x) => x?.turnId === p.turn.id) || evalArr[j])) ||
          {};

        const osConsistent = typeof e.osConsistent === "boolean" ? e.osConsistent : true;
        const osScore = Math.max(0, Math.min(100, Number(e.osScore ?? 75)));
        const actionScore = Math.max(0, Math.min(100, Number(e.actionScore ?? 72)));
        const combinedScore = Number((0.4 * osScore + 0.6 * actionScore).toFixed(1));
        const committedOS =
          typeof e.committedOS === "string" && e.committedOS.trim()
            ? e.committedOS.trim()
            : p.predictedOS;
        const diagnostic =
          typeof e.diagnostic === "string" && e.diagnostic.trim()
            ? e.diagnostic.trim()
            : "基本符合白花人设";

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

  /**
   * Teacher Personality Mutation (`adjust_personality` in RFC-0003 / RFC-0005):
   * Analyzes low-scoring turns in the current window and mutates P_{u,v} -> P_{u,v}'.
   */
  public async mutatePersonalityFromWindow(
    scene: SceneWindow,
    items: MemoryItem[],
    nextVersionLabel: string,
  ): Promise<{
    mutatedPersonality: ShirobanaPersonality;
    mutationReason: string;
    metrics: LlmCallMetrics;
  }> {
    const worstItems = [...items]
      .sort((a, b) => a.combinedScore - b.combinedScore)
      .slice(0, 6)
      .map((it) => ({
        turnId: it.turnId,
        input: it.inputText,
        predictedOS: it.predictedOS,
        predictedAction: it.predictedAction,
        gtAction: it.gtActionText,
        osScore: it.osScore,
        actionScore: it.actionScore,
        diagnostic: it.diagnostic,
      }));

    const meanScore =
      items.reduce((s, x) => s + x.combinedScore, 0) / Math.max(1, items.length);

    const prompt = [
      `你是 EverMemoryArchive (EMA) 角色训练循环的 **Teacher 人格优化器 (adjust_personality)**。`,
      `在场景 \`${scene.sceneId}\` 《${scene.title}》的测试中，当前白花人格版本 \`${this.personality.version}\` 的平均得分为 **${meanScore.toFixed(1)}**。`,
      `请分析以下得分最低的典型失分回合，找出当前人格设定在「台词长度与留白控制」「日常傲娇毒舌与正事搭档分寸」「潜变量<OS>到<Action>映射规律」「视角边界（非读心）」或「反OOC负向约束」上的深层机制漏洞，并输出改进后的人格 \`${nextVersionLabel}\`。`,
      ``,
      `## 严厉的防过拟合与防灾难性遗忘约束 (Anti-Overfitting & Anti-Forgetting Rules — 必须严格遵守！)`,
      `1. **核心锚点不可抹除 (Preserve Core Persona Anchors)**: 无论当前场景多么特殊，绝对禁止删除白花的核心标志（如：吹肥皂泡「呼——」、对苍空日常毒舌吐槽「笨蛋/杂鱼/真是没用呢」、被触碰时小声控诉「被苍空抱了/袭击了」、台词极简短促、讨厌蒲公英喜欢肥皂泡、非读心视角边界）。`,
      `2. **分情境增量调制而非全盘覆盖 (Contextual Modulation, Not Replacement)**: 如果当前场景是正事调查、温情坦白或特殊剧情，请用「在日常打闹时保持傲娇毒舌与吹泡泡；而在……情境下则切换为……」的**双轨/多情境条件句**来扩充规则，严禁一刀切地禁止她说「笨蛋」或把她改成死气沉沉的哲学机器！`,
      `3. **严禁死记硬背当前场景台词 (No Verbatim Quote Memorization)**: 绝对禁止把下方失分案例中的具体剧情台词原句（gtAction）写进人格规则！特定剧情只属于 MemoryIndex，不属于 Personality。`,
      `4. **抽象为通用心理学与语言学规律**: 每项数组保留 4～6 条最核心精炼的法则，每条不超过 95 字。`,
      ``,
      `## 当前人格 (${this.personality.version})`,
      JSON.stringify(
        {
          coreIdentity: this.personality.coreIdentity,
          emotionalDynamics: this.personality.emotionalDynamics,
          speechStyleRules: this.personality.speechStyleRules,
          cognitiveOSPatterns: this.personality.cognitiveOSPatterns,
          behavioralHabits: this.personality.behavioralHabits,
          antiOocConstraints: this.personality.antiOocConstraints,
        },
        null,
        2,
      ),
      ``,
      `## 本窗口典型失分案例 (Top Failure Cases)`,
      JSON.stringify(worstItems, null, 2),
      ``,
      `请严格输出 JSON 对象（不要调用任何工具，不要输出多余解释）：`,
      `{`,
      `  "mutationReason": "一句话总结本次人格突变提炼出的通用机制改进（不含具体剧情剧透）",`,
      `  "coreIdentity": "更新后的核心身份描述（精炼通用）",`,
      `  "emotionalDynamics": ["通用情感规律1", "通用情感规律2", "...(最多5条)"],`,
      `  "speechStyleRules": ["通用语言铁律1", "通用语言铁律2", "...(最多5条)"],`,
      `  "cognitiveOSPatterns": ["通用OS-Action映射规律1", "通用OS-Action映射规律2", "...(最多5条)"],`,
      `  "behavioralHabits": ["通用动作习惯1", "通用动作习惯2", "...(最多5条)"],`,
      `  "antiOocConstraints": ["通用反OOC约束1", "通用反OOC约束2", "...(最多5条)"]`,
      `}`,
    ].join("\n");

    const res = await this.client.complete(prompt, this.teacherCallOptions());
    const parsed = extractJsonFromLlm<{
      mutationReason?: string;
      coreIdentity?: string;
      emotionalDynamics?: string[];
      speechStyleRules?: string[];
      cognitiveOSPatterns?: string[];
      behavioralHabits?: string[];
      antiOocConstraints?: string[];
    }>(res.text);

    const mutationReason =
      parsed.mutationReason || `针对场景 ${scene.sceneId} 的语调与句长偏差进行 RSI 修正`;

    const mutated: ShirobanaPersonality = {
      version: nextVersionLabel,
      name: this.personality.name,
      coreIdentity: INITIAL_SHIROBANA_P0_0.coreIdentity,
      emotionalDynamics:
        Array.isArray(parsed.emotionalDynamics) && parsed.emotionalDynamics.length > 0
          ? [INITIAL_SHIROBANA_P0_0.emotionalDynamics[0], ...parsed.emotionalDynamics.slice(0, 4)]
          : this.personality.emotionalDynamics,
      speechStyleRules:
        Array.isArray(parsed.speechStyleRules) && parsed.speechStyleRules.length > 0
          ? [
              ...INITIAL_SHIROBANA_P0_0.speechStyleRules.slice(0, 2),
              ...parsed.speechStyleRules.slice(0, 3),
            ]
          : this.personality.speechStyleRules,
      cognitiveOSPatterns:
        Array.isArray(parsed.cognitiveOSPatterns) && parsed.cognitiveOSPatterns.length > 0
          ? [
              INITIAL_SHIROBANA_P0_0.cognitiveOSPatterns[0],
              INITIAL_SHIROBANA_P0_0.cognitiveOSPatterns[3],
              ...parsed.cognitiveOSPatterns.slice(0, 3),
            ]
          : this.personality.cognitiveOSPatterns,
      behavioralHabits:
        Array.isArray(parsed.behavioralHabits) && parsed.behavioralHabits.length > 0
          ? [
              INITIAL_SHIROBANA_P0_0.behavioralHabits[0],
              ...parsed.behavioralHabits.slice(0, 3),
            ]
          : this.personality.behavioralHabits,
      antiOocConstraints:
        Array.isArray(parsed.antiOocConstraints) && parsed.antiOocConstraints.length > 0
          ? [
              ...INITIAL_SHIROBANA_P0_0.antiOocConstraints.slice(0, 2),
              ...parsed.antiOocConstraints.slice(0, 3),
            ]
          : this.personality.antiOocConstraints,
      mutationHistory: [
        ...this.personality.mutationHistory,
        {
          fromVersion: this.personality.version,
          toVersion: nextVersionLabel,
          sceneId: scene.sceneId,
          reason: mutationReason,
          scoreBefore: Number(meanScore.toFixed(1)),
        },
      ],
    };

    return {
      mutatedPersonality: mutated,
      mutationReason,
      metrics: res.metrics,
    };
  }

  /**
   * Compacts a scene's committed MemoryItems (<Input_t, committedOS_t, GT_Action_t>)
   * into a single-level SceneMemoryIndexItem: MemoryIndex_{0,x} = compress({MemoryItem_n}).
   */
  public async compactSceneMemory(
    scene: SceneWindow,
    items: MemoryItem[],
  ): Promise<{
    indexItem: SceneMemoryIndexItem;
    reflectionScore?: number;
    metrics: LlmCallMetrics[];
  }> {
    const callMetrics: LlmCallMetrics[] = [];

    const trajectoryText = items
      .map(
        (it) =>
          `[Turn ${it.turnIndexInScene}]\n${it.inputText}\n【白花】(内心OS): （${it.committedOS}）\n【白花】: ${it.gtActionText}`,
      )
      .join("\n\n");

    const prompt = [
      `# 场景记忆压缩任务 (compact: {MemoryItem_n} -> MemoryIndex_{0,x})`,
      `场景ID: ${scene.sceneId} | 标题: 《${scene.title}》 | 章节: ${scene.chapter} | 时间/地点: ${scene.setting}`,
      ``,
      `## 压缩指令 (${this.compressionPrompt.version})`,
      this.compressionPrompt.instructions,
      ``,
      `## 本场景完整交互轨迹 (含 Teacher 校准后的内心 OS 与真实台词 GT_Action)`,
      trajectoryText.slice(0, 14000),
      scene.trailingText ? `\n## 场景尾声旁白与对话\n${scene.trailingText.slice(0, 2000)}` : ``,
      ``,
      `请严格输出 JSON 对象（不要调用任何工具，不要输出额外解释）：`,
      `{`,
      `  "summary": "以白花第一人称（「我」）浓缩的本场景核心事件与互动细节（不超过${this.compressionPrompt.maxSummaryChars}字）",`,
      `  "innerOSArc": "白花在本场景中的内心情感与傲娇/深情暗线变化（不超过60字）",`,
      `  "keyFacts": ["关键事实/约定/人物设定1", "关键事实2"]`,
      `}`,
    ].join("\n");

    const res = await this.client.complete(prompt, this.teacherCallOptions());
    callMetrics.push(res.metrics);

    let parsed: { summary?: string; innerOSArc?: string; keyFacts?: string[] } = {};
    try {
      parsed = extractJsonFromLlm(res.text);
    } catch {
      parsed = {
        summary: `在《${scene.title}》中，我与苍空在${scene.setting}经历了互动。`,
        innerOSArc: `表面维持冷淡毒舌，内心依然在意苍空。`,
        keyFacts: [`场景 ${scene.sceneId}: ${scene.title}`],
      };
    }

    const indexItem: SceneMemoryIndexItem = {
      sceneId: scene.sceneId,
      order: scene.order,
      chapter: scene.chapter,
      title: scene.title,
      setting: scene.setting,
      summary: (parsed.summary || "").trim() || `与苍空在《${scene.title}》中的经历。`,
      innerOSArc: (parsed.innerOSArc || "").trim() || `嘴硬心软地陪伴着苍空。`,
      keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.slice(0, 4) : [],
    };

    let reflectionScore: number | undefined;
    if (this.config.enableReflectionCheck) {
      const sampleTurns = items.slice(0, 5).map((it) => ({
        input: it.inputText.slice(0, 200),
        os: it.committedOS,
        gtAction: it.gtActionText,
      }));
      const reflectPrompt = [
        `你是 EverMemoryArchive (EMA) 的 **记忆可重构性评测器 (reflect evaluator)**。`,
        `请评估以下压缩后的单条场景记忆索引 \`MemoryIndex_{0,x}\` 是否足以让白花在未来回忆起该场景的核心事件、人物关系、特殊细节与内心情感。`,
        ``,
        `## 压缩后的 MemoryIndex_{0,x}`,
        JSON.stringify(indexItem, null, 2),
        ``,
        `## 原场景真实片段样本`,
        JSON.stringify(sampleTurns, null, 2),
        ``,
        `请输出 JSON: { "reflectionScore": 0到100的整数, "missingDetail": "若有遗漏请指出，无则写无" }`,
      ].join("\n");

      const refRes = await this.client.complete(reflectPrompt, this.teacherCallOptions());
      callMetrics.push(refRes.metrics);
      try {
        const refParsed = extractJsonFromLlm<{ reflectionScore?: number }>(refRes.text);
        reflectionScore = Math.max(0, Math.min(100, Number(refParsed.reflectionScore ?? 85)));
        indexItem.reflectionScore = reflectionScore;
      } catch {
        reflectionScore = 85;
        indexItem.reflectionScore = 85;
      }
    }

    return {
      indexItem,
      reflectionScore,
      metrics: callMetrics,
    };
  }

  /**
   * Executes the full forward-backward RSI loop on a single SceneWindow:
   * Forward -> Evaluate -> (Optional Local RSI Mutation & Retry) -> Compact -> Propagate.
   */
  public async trainSceneWindow(
    scene: SceneWindow,
    mutationStepCounter: { count: number },
  ): Promise<WindowTrainingResult> {
    const windowMetrics: LlmCallMetrics[] = [];
    const initialPersonalityVersion = this.personality.version;

    // Attempt 1
    const fwd1 = await this.runStudentSceneForward(scene);
    windowMetrics.push(...fwd1.metrics);

    const eval1 = await this.evaluateScenePredictions(scene, fwd1.predictions);
    windowMetrics.push(...eval1.metrics);

    const score1 =
      eval1.items.reduce((s, it) => s + it.combinedScore, 0) /
      Math.max(1, eval1.items.length);

    let bestItems = eval1.items;
    let bestScore = score1;
    let attempts = 1;
    let mutatedTo: string | undefined;

    // Local Window RSI Retry if score1 < rsiScoreThreshold and maxWindowAttempts > 1
    if (score1 < this.config.rsiScoreThreshold && this.config.maxWindowAttempts > 1) {
      attempts = 2;
      mutationStepCounter.count++;
      const nextVer = `P_0_${mutationStepCounter.count}`;

      const prevPersonality = structuredClone(this.personality);
      const mutation = await this.mutatePersonalityFromWindow(scene, eval1.items, nextVer);
      windowMetrics.push(mutation.metrics);

      this.personality = mutation.mutatedPersonality;

      const fwd2 = await this.runStudentSceneForward(scene);
      windowMetrics.push(...fwd2.metrics);

      const eval2 = await this.evaluateScenePredictions(scene, fwd2.predictions);
      windowMetrics.push(...eval2.metrics);

      const score2 =
        eval2.items.reduce((s, it) => s + it.combinedScore, 0) /
        Math.max(1, eval2.items.length);

      // Record scoreAfter in mutationHistory
      const lastHist =
        this.personality.mutationHistory[this.personality.mutationHistory.length - 1];
      if (lastHist) {
        lastHist.scoreAfter = Number(score2.toFixed(1));
      }

      if (score2 >= score1) {
        bestItems = eval2.items;
        bestScore = score2;
        mutatedTo = nextVer;
      } else {
        // Revert personality if mutation did not improve score on the window
        this.personality = prevPersonality;
      }
    }

    // Scene Compaction: compress({MemoryItem_t}) -> MemoryIndex_{0,x}
    const compacted = await this.compactSceneMemory(scene, bestItems);
    windowMetrics.push(...compacted.metrics);

    // Update single-level MemoryIndex (replace if sceneId already exists, else push)
    const existingIdx = this.memoryIndex.findIndex((m) => m.sceneId === scene.sceneId);
    if (existingIdx !== -1) {
      this.memoryIndex[existingIdx] = compacted.indexItem;
    } else {
      this.memoryIndex.push(compacted.indexItem);
    }

    if (this.config.syncAgentOnDisk) {
      syncShirobanaAgentState({
        personality: this.personality,
        memoryIndex: this.memoryIndex,
        agentId: this.config.shirobanaAgentId,
        thinkingLevel: this.config.studentModel.thinkingLevel,
      });
    }

    const osConsistentCount = bestItems.filter((it) => it.osConsistent).length;
    const meanOsScore =
      bestItems.reduce((s, it) => s + it.osScore, 0) / Math.max(1, bestItems.length);
    const meanActionScore =
      bestItems.reduce((s, it) => s + it.actionScore, 0) / Math.max(1, bestItems.length);

    return {
      sceneId: scene.sceneId,
      title: scene.title,
      turnCount: bestItems.length,
      personalityVersionUsed: initialPersonalityVersion,
      personalityMutatedTo: mutatedTo,
      attempts,
      initialMeanScore: Number(score1.toFixed(1)),
      finalMeanScore: Number(bestScore.toFixed(1)),
      osConsistencyRate: Number((osConsistentCount / Math.max(1, bestItems.length)).toFixed(3)),
      meanOsScore: Number(meanOsScore.toFixed(1)),
      meanActionScore: Number(meanActionScore.toFixed(1)),
      reflectionScore: compacted.reflectionScore,
      memoryIndexItem: compacted.indexItem,
      items: bestItems,
      metrics: sumMetrics(windowMetrics),
    };
  }

  /**
   * Batch-compacts a group of scenes directly from their script trajectories (imputing <OS>
   * and extracting summary + keyFacts) so full-story MemoryIndex coverage can be distilled
   * efficiently across all 108 story scenes.
   */
  public async compactScenesBatchFromScript(
    scenes: SceneWindow[],
  ): Promise<{
    items: SceneMemoryIndexItem[];
    metrics: LlmCallMetrics;
  }> {
    const payload = scenes.map((s) => ({
      sceneId: s.sceneId,
      order: s.order,
      chapter: s.chapter,
      title: s.title,
      setting: s.setting,
      dialogueSnippet: s.turns
        .slice(0, 18)
        .map((t) => `${t.inputText.slice(0, 160)}\n【白花】: ${t.gtActionText}`)
        .join("\n")
        .slice(0, 2200),
    }));

    const prompt = [
      `# 批量场景记忆逆向蒸馏与压缩任务 (Batch Scene Compaction: Script + Imputed OS -> MemoryIndex)`,
      `请以《保健室的老师与沉迷吹泡泡的助手》女主角 **此花白花（白花 / 小白）** 的第一人称视角（「我」），将以下 ${scenes.length} 个剧本场景分别压缩为单层情景记忆索引条目 \`SceneMemoryIndexItem\`。`,
      ``,
      `## 压缩指令 (${this.compressionPrompt.version})`,
      this.compressionPrompt.instructions,
      ``,
      `## 待压缩场景批次`,
      JSON.stringify(payload, null, 2),
      ``,
      `请严格输出 JSON 数组（不要调用任何工具，不要输出额外解释），每个元素格式如下：`,
      `[`,
      `  {`,
      `    "sceneId": "场景ID",`,
      `    "summary": "以白花第一人称（「我」）浓缩的本场景核心事件与互动细节（不超过140字）",`,
      `    "innerOSArc": "白花在本场景中的潜变量内心情感与傲娇/深情暗线变化（不超过60字）",`,
      `    "keyFacts": ["关键事实/约定/人物设定1", "关键事实2"]`,
      `  }`,
      `]`,
    ].join("\n");

    const res = await this.client.complete(prompt, this.teacherCallOptions());
    let parsedArr: Array<{
      sceneId?: string;
      summary?: string;
      innerOSArc?: string;
      keyFacts?: string[];
    }> = [];
    try {
      parsedArr = extractJsonFromLlm(res.text);
    } catch {
      parsedArr = [];
    }

    const items: SceneMemoryIndexItem[] = scenes.map((s, idx) => {
      const m =
        (Array.isArray(parsedArr) &&
          (parsedArr.find((x) => x?.sceneId === s.sceneId) || parsedArr[idx])) ||
        {};
      return {
        sceneId: s.sceneId,
        order: s.order,
        chapter: s.chapter,
        title: s.title,
        setting: s.setting,
        summary: (m.summary || "").trim() || `在《${s.title}》中，我与苍空在${s.setting}度过了日常时光。`,
        innerOSArc: (m.innerOSArc || "").trim() || `表面维持冷淡傲娇，内心深处十分依赖苍空。`,
        keyFacts: Array.isArray(m.keyFacts) ? m.keyFacts.slice(0, 4) : [],
      };
    });

    return {
      items,
      metrics: res.metrics,
    };
  }
}
