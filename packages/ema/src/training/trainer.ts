/**
 * @prism-shadow/ema - RFC-0003 / RFC-0004 / RFC-0005 Supervised Script Training Engine
 *
 * Orchestrates the supervised script reverse-engineering loop on top of the shared
 * `cognition/` and `compaction/` kernels:
 * 1. Cold-Start Warmup (`distillInitialPersonalityFromWarmup`): Initialize P_{0,0} from warmup scenes (q_{1..N})
 * 2. Student Forward (`runStudentSceneForward`): Input_t -> OS_t -> Action_t (delegates to `cognition/forward`)
 * 3. Teacher Evaluation (`evaluateScenePredictions`): Score against GT_Action_t^* (delegates to `cognition/forward`)
 * 4. Local Window RSI (`mutatePersonalityFromWindow`): Anchor-preserving mutation P_{u,v} -> P_{u,v}' (delegates to `cognition/persona-mutator`)
 * 5. Scene Compaction (`compactSceneMemory`): Compress {MemoryItem_t} -> MemoryIndex_{0,x} (delegates to `compaction/compactor`)
 */

import type {
  CompanionPersonality,
  CompressionPromptConfig,
  LlmCallMetrics,
  MemoryItem,
  SceneMemoryIndexItem,
  SceneWindow,
  TurnBundle,
  WindowTrainingResult,
} from "../cognition/types.js";
import {
  type LlmCallOptions,
  PenguinServerLLMClient,
  sumMetrics,
} from "../cognition/llm-client.js";
import {
  createDefaultCompressionPrompt,
  createInitialPersonalityTemplate,
  extractJsonFromLlm,
  mutatePersonalityWithAnchors,
  parseStudentTurnOutput,
  syncCompanionAgentState,
} from "../cognition/persona-mutator.js";
import {
  buildCompanionReactPrompt,
  evaluateScenePredictionsWithTarget,
  type ForwardPrediction,
  runCompanionSceneForward,
} from "../cognition/forward.js";
import { EmaMemoryCompactor } from "../compaction/compactor.js";

export { parseStudentTurnOutput, extractJsonFromLlm };

export interface TrainerConfig {
  /** Target character display name */
  targetCharacter?: string;
  /** Counterpart / protagonist name in the narrative */
  protagonistCharacter?: string;
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
  /** Agent ID in PenguinHarness for the Student companion (default: "ema_minimal") */
  companionAgentId?: string;
  /** Agent ID in PenguinHarness for the Teacher evaluator (default: "ema_minimal") */
  teacherAgentId?: string;
  /** Minimum acceptable window score before triggering local RSI retry (default: 78) */
  rsiScoreThreshold?: number;
  /** Maximum attempts per scene window (1 = no retry, 2 = 1 retry after mutation; default: 2) */
  maxWindowAttempts?: number;
  /** Micro-batch size for Student forward calls within a scene (1 = strict turn-by-turn; default: 4) */
  studentBatchSize?: number;
  /** Whether to run reflection check on compacted scene memory (default: true) */
  enableReflectionCheck?: boolean;
  /** Sync companion AGENTS.md on disk after each scene window (default: false) */
  syncAgentOnDisk?: boolean;
}

export class EmaPersonaTrainer {
  public readonly client: PenguinServerLLMClient;
  public readonly config: Required<TrainerConfig>;
  public personality: CompanionPersonality;
  public anchorPersonality: CompanionPersonality;
  public compressionPrompt: CompressionPromptConfig;
  public memoryIndex: SceneMemoryIndexItem[];

  constructor(
    config: TrainerConfig,
    options?: {
      client?: PenguinServerLLMClient;
      initialPersonality?: CompanionPersonality;
      initialCompressionPrompt?: CompressionPromptConfig;
      initialMemoryIndex?: SceneMemoryIndexItem[];
    },
  ) {
    this.client = options?.client || new PenguinServerLLMClient();
    const targetCharacter =
      config.targetCharacter || options?.initialPersonality?.name || "Companion";
    const protagonistCharacter = config.protagonistCharacter || "主角";

    this.config = {
      targetCharacter,
      protagonistCharacter,
      companionAgentId: "ema_minimal",
      teacherAgentId: "ema_minimal",
      rsiScoreThreshold: 78,
      maxWindowAttempts: 2,
      studentBatchSize: 4,
      enableReflectionCheck: true,
      syncAgentOnDisk: false,
      ...config,
    };

    const seedPersonality = options?.initialPersonality
      ? structuredClone(options.initialPersonality)
      : createInitialPersonalityTemplate({
          name: targetCharacter,
          protagonistName: protagonistCharacter,
        });

    this.personality = structuredClone(seedPersonality);
    this.anchorPersonality = structuredClone(seedPersonality);
    this.compressionPrompt = options?.initialCompressionPrompt
      ? structuredClone(options.initialCompressionPrompt)
      : createDefaultCompressionPrompt(targetCharacter, protagonistCharacter);
    this.memoryIndex = options?.initialMemoryIndex
      ? structuredClone(options.initialMemoryIndex)
      : [];
  }

  private studentCallOptions(): LlmCallOptions {
    return {
      agentId: this.config.companionAgentId,
      provider: this.config.studentModel.provider,
      modelId: this.config.studentModel.modelId,
      thinkingLevel: this.config.studentModel.thinkingLevel,
    };
  }

  private teacherCallOptions(): LlmCallOptions {
    return {
      agentId: this.config.teacherAgentId,
      provider: this.config.teacherModel.provider,
      modelId: this.config.teacherModel.modelId,
      thinkingLevel: this.config.teacherModel.thinkingLevel,
    };
  }

  /**
   * RFC-0003 §2.1 / RFC-0005 Cold-Start Warmup Distillation:
   * P_{0,0} = distill(q_1, ..., q_N) from the first N warmup scenes.
   */
  public async distillInitialPersonalityFromWarmup(
    warmupScenes: SceneWindow[],
  ): Promise<{
    personality: CompanionPersonality;
    metrics: LlmCallMetrics;
  }> {
    const target = this.config.targetCharacter;
    const protagonist = this.config.protagonistCharacter;
    const sampleBlocks = warmupScenes.slice(0, 5).map((s) => ({
      sceneId: s.sceneId,
      title: s.title,
      setting: s.setting,
      turns: s.turns.slice(0, 12).map((t) => ({
        input: t.inputText.slice(0, 220),
        gtAction: t.gtActionText,
        explicitOS: t.explicitOS,
      })),
    }));

    const prompt = [
      `你是 EverMemoryArchive (EMA) 的 **冷启动人格逆向蒸馏器 (Cold-Start Warmup Distiller, P_{0,0} = distill(q_1..q_N))**。`,
      `请根据以下前序预热场景中目标角色「${target}」与「${protagonist}」及周围人物的真实交互样本，逆向提炼出「${target}」的初始结构化人格档案 \`P_0_0\`。`,
      ``,
      `## 预热场景样本`,
      JSON.stringify(sampleBlocks, null, 2),
      ``,
      `## 提炼准则`,
      `1. **禁止照搬具体剧情或台词原句**: 提炼通用的人格机制、情感动力学、语言句长铁律与口癖、潜变量 <OS> 到 <Action> 的心理映射规律、标志性动作习惯，以及反 OOC 约束。`,
      `2. **视角边界（非读心铁律）**: 明确规定剧本「[旁白]」中未说出口的第一人称心理活动不可被「${target}」直接读心回应。`,
      ``,
      `请严格输出 JSON 对象（不要调用任何工具，不要输出多余说明）：`,
      `{`,
      `  "coreIdentity": "核心身份、背景设定与对${protagonist}的关系定位",`,
      `  "emotionalDynamics": ["情感特质与内外反差规律1", "规律2", "规律3"],`,
      `  "speechStyleRules": ["句长控制、语调与标志性口癖1", "规律2", "规律3"],`,
      `  "cognitiveOSPatterns": ["潜变量<OS>到<Action>映射规律1", "规律2", "视角边界（非读心铁律）"],`,
      `  "behavioralHabits": ["标志性肢体动作或习惯1", "习惯2", "习惯3"],`,
      `  "antiOocConstraints": ["反AI腔调约束", "句长与情绪边界负向约束", "免工具直出约束"]`,
      `}`,
    ].join("\n");

    const res = await this.client.complete(prompt, this.teacherCallOptions());
    const parsed = extractJsonFromLlm<Partial<CompanionPersonality>>(res.text);

    const distilled: CompanionPersonality = {
      version: "P_0_0",
      name: target,
      coreIdentity: parsed.coreIdentity || this.personality.coreIdentity,
      emotionalDynamics:
        Array.isArray(parsed.emotionalDynamics) && parsed.emotionalDynamics.length > 0
          ? parsed.emotionalDynamics
          : this.personality.emotionalDynamics,
      speechStyleRules:
        Array.isArray(parsed.speechStyleRules) && parsed.speechStyleRules.length > 0
          ? parsed.speechStyleRules
          : this.personality.speechStyleRules,
      cognitiveOSPatterns:
        Array.isArray(parsed.cognitiveOSPatterns) && parsed.cognitiveOSPatterns.length > 0
          ? parsed.cognitiveOSPatterns
          : this.personality.cognitiveOSPatterns,
      behavioralHabits:
        Array.isArray(parsed.behavioralHabits) && parsed.behavioralHabits.length > 0
          ? parsed.behavioralHabits
          : this.personality.behavioralHabits,
      antiOocConstraints:
        Array.isArray(parsed.antiOocConstraints) && parsed.antiOocConstraints.length > 0
          ? parsed.antiOocConstraints
          : this.personality.antiOocConstraints,
      mutationHistory: [],
    };

    this.personality = structuredClone(distilled);
    this.anchorPersonality = structuredClone(distilled);

    return {
      personality: distilled,
      metrics: res.metrics,
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
    return buildCompanionReactPrompt({
      targetCharacter: this.config.targetCharacter,
      protagonistCharacter: this.config.protagonistCharacter,
      personality: this.personality,
      memoryIndex: this.memoryIndex,
      scene,
      priorTurnsInScene,
      targetTurns,
      includeInlinePersonaAndMemory:
        options?.includeInlinePersonaAndMemory ?? !this.config.syncAgentOnDisk,
    });
  }

  /**
   * Runs Student forward predictions (`react`) across all turns of a scene window.
   */
  public async runStudentSceneForward(scene: SceneWindow): Promise<{
    predictions: ForwardPrediction[];
    metrics: LlmCallMetrics[];
  }> {
    return runCompanionSceneForward({
      client: this.client,
      studentCallOptions: this.studentCallOptions(),
      targetCharacter: this.config.targetCharacter,
      protagonistCharacter: this.config.protagonistCharacter,
      personality: this.personality,
      memoryIndex: this.memoryIndex,
      scene,
      batchSize: this.config.studentBatchSize,
      syncAgentOnDisk: this.config.syncAgentOnDisk,
      companionAgentId: this.config.companionAgentId,
    });
  }

  /**
   * Teacher evaluation (`evaluate`) of a scene window's predictions against Ground Truth Action_t^*.
   */
  public async evaluateScenePredictions(
    scene: SceneWindow,
    predictions: ForwardPrediction[],
  ): Promise<{
    items: MemoryItem[];
    metrics: LlmCallMetrics[];
  }> {
    return evaluateScenePredictionsWithTarget({
      client: this.client,
      teacherCallOptions: this.teacherCallOptions(),
      targetCharacter: this.config.targetCharacter,
      personality: this.personality,
      scene,
      predictions,
    });
  }

  /**
   * Teacher Personality Mutation (`adjust_personality` in RFC-0003 / RFC-0005):
   * Delegates to Anchor-Preserving Modulation (`mutatePersonalityWithAnchors`).
   */
  public async mutatePersonalityFromWindow(
    scene: SceneWindow,
    items: MemoryItem[],
    nextVersionLabel: string,
  ): Promise<{
    mutatedPersonality: CompanionPersonality;
    mutationReason: string;
    metrics: LlmCallMetrics;
  }> {
    return mutatePersonalityWithAnchors({
      client: this.client,
      teacherCallOptions: this.teacherCallOptions(),
      targetCharacter: this.config.targetCharacter,
      currentPersonality: this.personality,
      anchorPersonality: this.anchorPersonality,
      scene,
      items,
      nextVersionLabel,
      mode: "training",
    });
  }

  /**
   * Compacts a scene's committed MemoryItems into a single-level SceneMemoryIndexItem
   * via `EmaMemoryCompactor` (RFC-0006).
   */
  public async compactSceneMemory(
    scene: SceneWindow,
    items: MemoryItem[],
  ): Promise<{
    indexItem: SceneMemoryIndexItem;
    reflectionScore?: number;
    metrics: LlmCallMetrics[];
  }> {
    const compactor = new EmaMemoryCompactor(
      {
        targetCharacter: this.config.targetCharacter,
        protagonistCharacter: this.config.protagonistCharacter,
        model: this.config.teacherModel,
        evaluatorAgentId: this.config.teacherAgentId,
        companionAgentId: this.config.companionAgentId,
        enableReflectionCheck: this.config.enableReflectionCheck,
      },
      {
        client: this.client,
        compressionPrompt: this.compressionPrompt,
      },
    );
    const res = await compactor.compactSceneMemory(scene, items);
    return {
      indexItem: res.indexItem,
      reflectionScore: res.reflectionScore,
      metrics: res.metrics,
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
        this.personality = prevPersonality;
      }
    }

    const compacted = await this.compactSceneMemory(scene, bestItems);
    windowMetrics.push(...compacted.metrics);

    const existingIdx = this.memoryIndex.findIndex((m) => m.sceneId === scene.sceneId);
    if (existingIdx !== -1) {
      this.memoryIndex[existingIdx] = compacted.indexItem;
    } else {
      this.memoryIndex.push(compacted.indexItem);
    }

    if (this.config.syncAgentOnDisk) {
      syncCompanionAgentState({
        personality: this.personality,
        memoryIndex: this.memoryIndex,
        agentId: this.config.companionAgentId,
        protagonistName: this.config.protagonistCharacter,
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
   * efficiently across large narrative scripts.
   */
  public async compactScenesBatchFromScript(
    scenes: SceneWindow[],
  ): Promise<{
    items: SceneMemoryIndexItem[];
    metrics: LlmCallMetrics;
  }> {
    const target = this.config.targetCharacter;
    const protagonist = this.config.protagonistCharacter;
    const payload = scenes.map((s) => ({
      sceneId: s.sceneId,
      order: s.order,
      chapter: s.chapter,
      title: s.title,
      setting: s.setting,
      dialogueSnippet: s.turns
        .slice(0, 18)
        .map((t) => `${t.inputText.slice(0, 160)}\n【${target}】: ${t.gtActionText}`)
        .join("\n")
        .slice(0, 2200),
    }));

    const prompt = [
      `# 批量场景记忆逆向蒸馏与压缩任务 (Batch Scene Compaction: Script + Imputed OS -> MemoryIndex)`,
      `请以目标角色 **${target}** 的第一人称视角（「我」），将以下 ${scenes.length} 个剧本场景分别压缩为单层情景记忆索引条目 \`SceneMemoryIndexItem\`。`,
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
      `    "summary": "以${target}第一人称（「我」）浓缩的本场景核心事件与互动细节（不超过140字）",`,
      `    "innerOSArc": "${target}在本场景中的潜变量内心情感与潜台词变化（不超过60字）",`,
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
        summary:
          (m.summary || "").trim() || `在《${s.title}》中，我与${protagonist}在${s.setting}度过了时光。`,
        innerOSArc: (m.innerOSArc || "").trim() || `内心情绪随互动自然流转。`,
        keyFacts: Array.isArray(m.keyFacts) ? m.keyFacts.slice(0, 4) : [],
      };
    });

    return {
      items,
      metrics: res.metrics,
    };
  }
}
