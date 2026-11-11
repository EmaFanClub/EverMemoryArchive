/**
 * @prism-shadow/ema - Memory Compaction & Hierarchical Indexing Engine (RFC-0006)
 *
 * Implements the `compact` algorithm:
 * 1. Level-0 Trajectory Folding: {MemoryItem_t} -> MemoryIndex_{0,x}
 * 2. Self-Healing `compact + reflect` Closed Loop: evaluates reconstructibility R in [0, 100],
 *    automatically re-compacts with `missingDetail` when R < threshold, and evolves C -> C'
 * 3. Level-0 -> Level-1 Hierarchical Rollup: {MemoryIndex_{0,x}} -> MemoryIndex_{1,y}
 * 4. Cursor-Idempotent Incremental Route Session Compaction (`compactRouteSession`)
 */

import fs from "node:fs";
import type {
  CompanionCognitiveState,
  CompactionRunResult,
  CompressionPromptConfig,
  EpochMemoryIndexItem,
  LiveConversationTurn,
  LlmCallMetrics,
  MemoryItem,
  SceneMemoryIndexItem,
  SceneWindow,
} from "../cognition/types.js";
import {
  type LlmCallOptions,
  PenguinServerLLMClient,
  parseSessionTraceTurns,
  sumMetrics,
} from "../cognition/llm-client.js";
import {
  createDefaultCompressionPrompt,
  extractJsonFromLlm,
  syncCompanionAgentState,
} from "../cognition/persona-mutator.js";
import {
  type BoundaryDetectorOptions,
  convertSliceToSceneAndMemoryItems,
  sliceTurnsIntoEpisodicWindows,
} from "./boundary-detector.js";
import { appendColdArchiveRecord, saveCognitiveState } from "./archive-store.js";

export interface EmaCompactorConfig {
  targetCharacter: string;
  protagonistCharacter?: string;
  model?: {
    provider: string;
    modelId: string;
    thinkingLevel?: "low" | "medium" | "high";
  };
  evaluatorAgentId?: string;
  companionAgentId?: string;
  enableReflectionCheck?: boolean;
  reflectionThreshold?: number;
  enableCompressionPromptEvolution?: boolean;
  /** Trigger L0 -> L1 rollup when active L0 scenes reach this count (default: 40) */
  l0RollupThreshold?: number;
  /** Number of oldest active L0 scenes to fold into one L1 Epoch item per rollup (default: 10) */
  l0RollupBatchSize?: number;
  /** SQLite database file path for persistent cold memory archive (RFC-0006) */
  archiveDbPath?: string;
  /** @deprecated Alias for archiveDbPath */
  archiveJsonlPath?: string;
  statePath?: string;
  syncAgentOnDisk?: boolean;
}

export class EmaMemoryCompactor {
  public readonly config: Required<
    Pick<
      EmaCompactorConfig,
      | "targetCharacter"
      | "protagonistCharacter"
      | "enableReflectionCheck"
      | "reflectionThreshold"
      | "enableCompressionPromptEvolution"
      | "l0RollupThreshold"
      | "l0RollupBatchSize"
      | "syncAgentOnDisk"
    >
  > &
    EmaCompactorConfig;

  public readonly client: PenguinServerLLMClient;
  public compressionPrompt: CompressionPromptConfig;

  constructor(
    config: EmaCompactorConfig,
    options?: {
      client?: PenguinServerLLMClient;
      compressionPrompt?: CompressionPromptConfig;
    },
  ) {
    this.config = {
      ...config,
      targetCharacter: config.targetCharacter || "Companion",
      protagonistCharacter: config.protagonistCharacter || "Owner",
      enableReflectionCheck: config.enableReflectionCheck ?? true,
      reflectionThreshold: config.reflectionThreshold ?? 80,
      enableCompressionPromptEvolution: config.enableCompressionPromptEvolution ?? false,
      l0RollupThreshold: config.l0RollupThreshold ?? 40,
      l0RollupBatchSize: config.l0RollupBatchSize ?? 10,
      syncAgentOnDisk: config.syncAgentOnDisk ?? false,
    };

    this.client = options?.client || new PenguinServerLLMClient();
    this.compressionPrompt =
      options?.compressionPrompt ||
      createDefaultCompressionPrompt(
        this.config.targetCharacter,
        this.config.protagonistCharacter,
      );
  }

  private callOptions(): LlmCallOptions {
    return {
      agentId: this.config.evaluatorAgentId || "ema_minimal",
      provider: this.config.model?.provider || "penguin-go",
      modelId: this.config.model?.modelId || "gemini-3.8-flash",
      thinkingLevel: this.config.model?.thinkingLevel || "medium",
    };
  }

  /**
   * Compacts a scene's committed `MemoryItem[]` into a Level-0 `SceneMemoryIndexItem`
   * with optional self-healing `reflect` check and retry.
   */
  public async compactSceneMemory(
    scene: SceneWindow,
    items: MemoryItem[],
    options?: { archiveRef?: string },
  ): Promise<{
    indexItem: SceneMemoryIndexItem;
    reflectionScore?: number;
    missingDetail?: string;
    retriedWithReflection: boolean;
    metrics: LlmCallMetrics[];
  }> {
    const target = this.config.targetCharacter;
    const protagonist = this.config.protagonistCharacter;
    const callMetrics: LlmCallMetrics[] = [];

    const trajectoryText = items
      .map(
        (it) =>
          `[Turn ${it.turnIndexInScene}]\n${it.inputText}\n【${target}】(内心OS): （${it.committedOS}）\n【${target}】: ${it.gtActionText}`,
      )
      .join("\n\n");

    const buildCompactPrompt = (extraRecoveryHint?: string) =>
      [
        `# 场景记忆压缩任务 (compact: {MemoryItem_n} -> MemoryIndex_{0,x})`,
        `场景ID: ${scene.sceneId} | 标题: 《${scene.title}》 | 章节: ${scene.chapter} | 时间/地点: ${scene.setting}`,
        ``,
        `## 压缩指令 (${this.compressionPrompt.version})`,
        this.compressionPrompt.instructions,
        extraRecoveryHint
          ? `\n## 遗漏细节强制补全要求 (Self-Healing Reflection Recovery)\n上一轮压缩遗漏了以下关键信息，本次压缩必须将其完整融入 summary 或 keyFacts 中：\n- ${extraRecoveryHint}`
          : ``,
        ``,
        `## 本场景完整交互轨迹 (含内心 OS 与真实回复 Action)`,
        trajectoryText.slice(0, 14000),
        scene.trailingText ? `\n## 场景尾声旁白与对话\n${scene.trailingText.slice(0, 2000)}` : ``,
        ``,
        `请严格输出 JSON 对象（不要调用任何工具，不要输出额外解释）：`,
        `{`,
        `  "summary": "以${target}第一人称（「我」）浓缩的本场景核心事件与互动细节（不超过${this.compressionPrompt.maxSummaryChars}字）",`,
        `  "innerOSArc": "${target}在本场景中的内心情感与潜台词变化（不超过60字）",`,
        `  "keyFacts": ["关键事实/约定/人物设定1", "关键事实2"]`,
        `}`,
      ].join("\n");

    const runSingleCompact = async (hint?: string): Promise<SceneMemoryIndexItem> => {
      const res = await this.client.complete(buildCompactPrompt(hint), this.callOptions());
      callMetrics.push(res.metrics);

      const parsed = extractJsonFromLlm<{
        summary?: string;
        innerOSArc?: string;
        keyFacts?: string[];
      }>(res.text);
      const summary = (parsed.summary || "").trim();
      const innerOSArc = (parsed.innerOSArc || "").trim();
      if (!summary || !innerOSArc) {
        throw new Error(
          `Invalid compaction output for scene ${scene.sceneId}: missing non-empty summary or innerOSArc`,
        );
      }

      return {
        sceneId: scene.sceneId,
        order: scene.order,
        chapter: scene.chapter,
        title: scene.title,
        setting: scene.setting,
        summary,
        innerOSArc,
        keyFacts: Array.isArray(parsed.keyFacts)
          ? parsed.keyFacts.slice(0, Math.max(1, this.compressionPrompt.maxKeyFacts))
          : [],
        ...(options?.archiveRef ? { archiveRef: options.archiveRef } : {}),
      };
    };

    let indexItem = await runSingleCompact();
    let reflectionScore: number | undefined;
    let missingDetail: string | undefined;
    let retriedWithReflection = false;

    if (this.config.enableReflectionCheck) {
      const evaluateReflect = async (
        candidate: SceneMemoryIndexItem,
      ): Promise<{ score: number; missing: string }> => {
        const sampleTurns = items.slice(0, 6).map((it) => ({
          input: it.inputText.slice(0, 220),
          os: it.committedOS,
          action: it.gtActionText,
        }));
        const reflectPrompt = [
          `你是 EverMemoryArchive (EMA) 的 **记忆可重构性评测器 (reflect evaluator)**。`,
          `请评估以下压缩后的单条场景记忆索引 \`MemoryIndex_{0,x}\` 是否足以让角色「${target}」在未来准确回忆起该场景的核心事件、人物关系、特殊细节与内心情感。`,
          ``,
          `## 压缩后的 MemoryIndex_{0,x}`,
          JSON.stringify(candidate, null, 2),
          ``,
          `## 原场景真实交互片段`,
          JSON.stringify(sampleTurns, null, 2),
          ``,
          `请输出 JSON: { "reflectionScore": 0到100的整数, "missingDetail": "若有遗漏的关键事实/情感细节请指出，无则写无" }`,
        ].join("\n");

        const refRes = await this.client.complete(reflectPrompt, this.callOptions());
        callMetrics.push(refRes.metrics);
        const refParsed = extractJsonFromLlm<{
          reflectionScore?: number;
          missingDetail?: string;
        }>(refRes.text);
        if (typeof refParsed.reflectionScore !== "number") {
          throw new Error("Invalid reflection evaluation output: missing numeric reflectionScore");
        }
        return {
          score: Math.max(0, Math.min(100, refParsed.reflectionScore)),
          missing: (refParsed.missingDetail || "").trim(),
        };
      };

      const firstEval = await evaluateReflect(indexItem);
      reflectionScore = firstEval.score;
      missingDetail = firstEval.missing;
      indexItem.reflectionScore = reflectionScore;

      // Self-Healing Retry when reflectionScore < threshold
      if (
        reflectionScore < this.config.reflectionThreshold &&
        missingDetail &&
        missingDetail !== "无" &&
        missingDetail.toLowerCase() !== "none"
      ) {
        retriedWithReflection = true;
        const healedItem = await runSingleCompact(missingDetail);
        const secondEval = await evaluateReflect(healedItem);
        if (secondEval.score >= reflectionScore) {
          indexItem = healedItem;
          reflectionScore = secondEval.score;
          indexItem.reflectionScore = reflectionScore;
        }
      }
    }

    return {
      indexItem,
      reflectionScore,
      missingDetail,
      retriedWithReflection,
      metrics: callMetrics,
    };
  }

  /**
   * Evolves the trainable compression operator C_{u,v} -> C_{u,v+1} when recurring
   * reflection detail losses are observed (RFC-0004 / RFC-0006).
   */
  public evolveCompressionPrompt(missingDetails: string[]): CompressionPromptConfig {
    const valid = missingDetails.filter(
      (m) => m && m !== "无" && m.toLowerCase() !== "none",
    );
    if (valid.length === 0) return this.compressionPrompt;

    const match = this.compressionPrompt.version.match(/^C_(\d+)_(\d+)$/);
    const nextVersion = match
      ? `C_${match[1]}_${Number(match[2]) + 1}`
      : `${this.compressionPrompt.version}_next`;

    const synthesizedRule = `4. 特别防遗漏约束（自愈演进 ${nextVersion}）：务必保留对话中的具体书名/作品名、专属约定、情绪转折触发点与特殊物品细节（近期易漏点：${valid.slice(0, 2).join("；").slice(0, 80)}）。`;

    this.compressionPrompt = {
      ...this.compressionPrompt,
      version: nextVersion,
      instructions: `${this.compressionPrompt.instructions}\n${synthesizedRule}`,
    };
    return this.compressionPrompt;
  }

  /**
   * Level-0 -> Level-1 Hierarchical Rollup (RFC-0006):
   * Folds a batch of contiguous Level-0 `SceneMemoryIndexItem[]` into a single Level-1
   * `EpochMemoryIndexItem` (`MemoryIndex_{1,y}`) and marks the source L0 items as rolled up.
   */
  public async rollupL0BatchToL1(
    l0Batch: SceneMemoryIndexItem[],
    epochOrder: number,
  ): Promise<{
    epochItem: EpochMemoryIndexItem;
    metrics: LlmCallMetrics[];
  }> {
    const target = this.config.targetCharacter;
    const protagonist = this.config.protagonistCharacter;
    const epochId = `epoch_${String(epochOrder).padStart(3, "0")}`;
    const callMetrics: LlmCallMetrics[] = [];

    const first = l0Batch[0];
    const last = l0Batch[l0Batch.length - 1];
    const timeSpan = `${first.sceneId} (${first.setting}) ~ ${last.sceneId} (${last.setting})`;

    const prompt = [
      `# 阶段记忆跨幕归并任务 (Hierarchical Rollup: {MemoryIndex_{0,x}} -> MemoryIndex_{1,y})`,
      `角色: ${target} | 陪伴对象: ${protagonist} | 阶段ID: ${epochId} | 跨度: ${timeSpan}`,
      ``,
      `请以「${target}」的第一人称视角（「我」），将以下连续 ${l0Batch.length} 幕单层场景记忆索引归并浓缩为 1 条高密度的阶段记忆索引（EpochMemoryIndexItem）。`,
      `要求：`,
      `1. title（不超过18字）：为这一阶段的共同经历起一个富有画面感的标题。`,
      `2. summary（不超过220字）：串联这 ${l0Batch.length} 幕的核心事件脉络、重要互动与关键转折。`,
      `3. emotionalEvolutionArc（不超过80字）：提炼这一阶段中我对${protagonist}的情感变化与认知深化轨迹。`,
      `4. consolidatedKeyFacts（3～6条）：对各幕的 keyFacts 进行去重、合并与提炼，保留必须长期铭记的核心事实、习惯喜好与约定。`,
      ``,
      `## 待归并的 Level-0 场景记忆列表`,
      JSON.stringify(
        l0Batch.map((s) => ({
          sceneId: s.sceneId,
          title: s.title,
          setting: s.setting,
          summary: s.summary,
          innerOSArc: s.innerOSArc,
          keyFacts: s.keyFacts,
        })),
        null,
        2,
      ),
      ``,
      `请严格输出 JSON 对象（不要调用工具，不要输出多余说明）：`,
      `{`,
      `  "title": "阶段标题",`,
      `  "summary": "第一人称阶段宏观摘要",`,
      `  "emotionalEvolutionArc": "心境与关系演进脉络",`,
      `  "consolidatedKeyFacts": ["长期核心事实1", "长期核心事实2"]`,
      `}`,
    ].join("\n");

    const res = await this.client.complete(prompt, this.callOptions());
    callMetrics.push(res.metrics);

    const parsed = extractJsonFromLlm<{
      title?: string;
      summary?: string;
      emotionalEvolutionArc?: string;
      consolidatedKeyFacts?: string[];
    }>(res.text);

    const title = (parsed.title || "").trim();
    const summary = (parsed.summary || "").trim();
    const emotionalEvolutionArc = (parsed.emotionalEvolutionArc || "").trim();
    if (!title || !summary || !emotionalEvolutionArc) {
      throw new Error(
        `Invalid L1 epoch rollup output for ${epochId}: missing title, summary, or emotionalEvolutionArc`,
      );
    }

    const epochItem: EpochMemoryIndexItem = {
      epochId,
      order: epochOrder,
      title,
      timeSpan,
      sourceSceneIds: l0Batch.map((s) => s.sceneId),
      summary,
      emotionalEvolutionArc,
      consolidatedKeyFacts: Array.isArray(parsed.consolidatedKeyFacts)
        ? parsed.consolidatedKeyFacts.slice(0, 6)
        : [],
    };

    for (const s of l0Batch) {
      s.rolledUpIntoEpochId = epochId;
    }

    return { epochItem, metrics: callMetrics };
  }

  /**
   * Incrementally compacts new turns from a `LiveConversationTurn[]` stream into `state`,
   * performs cold archiving and L0 -> L1 rollup when thresholds are reached, and optionally
   * saves `state` and syncs `AGENTS.md`.
   */
  public async compactTurnStream(
    turns: LiveConversationTurn[],
    state: CompanionCognitiveState,
    options?: {
      sessionKey?: string;
      boundaryOptions?: BoundaryDetectorOptions;
    },
  ): Promise<CompactionRunResult> {
    const sessionKey = options?.sessionKey || "default";
    const previousCursor = state.sessionTurnCursors[sessionKey] ?? 0;
    const startOrder = state.memoryIndex.length + 1;

    const slices = sliceTurnsIntoEpisodicWindows(turns, previousCursor, {
      startOrder,
      ...options?.boundaryOptions,
    });

    const newL0Items: SceneMemoryIndexItem[] = [];
    const newL1Items: EpochMemoryIndexItem[] = [];
    const allMetrics: LlmCallMetrics[] = [];
    const missingDetailsObserved: string[] = [];
    let retriedWithReflectionCount = 0;
    let newCursor = previousCursor;
    let compactedTurnCount = 0;

    this.compressionPrompt = state.compressionPrompt;

    for (const slice of slices) {
      const { scene, items } = convertSliceToSceneAndMemoryItems(
        slice,
        this.config.targetCharacter,
      );

      let archiveRef: string | undefined;
      const archiveDbPath = this.config.archiveDbPath || this.config.archiveJsonlPath;
      if (archiveDbPath) {
        archiveRef = appendColdArchiveRecord(archiveDbPath, {
          archiveId: `${scene.sceneId}@${Date.now()}`,
          sceneId: scene.sceneId,
          title: scene.title,
          setting: scene.setting,
          items,
        });
      }

      const compacted = await this.compactSceneMemory(scene, items, { archiveRef });
      allMetrics.push(...compacted.metrics);
      if (compacted.retriedWithReflection) {
        retriedWithReflectionCount++;
      }
      if (compacted.missingDetail) {
        missingDetailsObserved.push(compacted.missingDetail);
      }

      state.memoryIndex.push(compacted.indexItem);
      newL0Items.push(compacted.indexItem);
      newCursor = Math.max(newCursor, slice.endTurnIndex);
      compactedTurnCount += slice.turns.length;
    }

    let compressionMutatedTo: CompressionPromptConfig | undefined;
    if (
      this.config.enableCompressionPromptEvolution &&
      retriedWithReflectionCount > 0 &&
      missingDetailsObserved.length > 0
    ) {
      compressionMutatedTo = this.evolveCompressionPrompt(missingDetailsObserved);
      state.compressionPrompt = compressionMutatedTo;
    }

    // Check L0 -> L1 hierarchical rollup threshold
    const activeL0 = state.memoryIndex.filter((m) => !m.rolledUpIntoEpochId);
    if (activeL0.length >= this.config.l0RollupThreshold) {
      const batchSize = Math.min(
        this.config.l0RollupBatchSize,
        Math.max(1, activeL0.length - 1),
      );
      const batchToRollup = activeL0.slice(0, batchSize);
      const nextEpochOrder = state.l1MemoryIndex.length + 1;
      const rolled = await this.rollupL0BatchToL1(batchToRollup, nextEpochOrder);
      allMetrics.push(...rolled.metrics);
      state.l1MemoryIndex.push(rolled.epochItem);
      newL1Items.push(rolled.epochItem);
    }

    state.sessionTurnCursors[sessionKey] = newCursor;

    if (this.config.statePath) {
      saveCognitiveState(this.config.statePath, state);
    }

    if (this.config.syncAgentOnDisk && (this.config.companionAgentId || state.agentId)) {
      syncCompanionAgentState({
        personality: state.personality,
        memoryIndex: state.memoryIndex,
        l1MemoryIndex: state.l1MemoryIndex,
        agentId: this.config.companionAgentId || state.agentId,
        protagonistName: state.protagonistName,
      });
    }

    return {
      newL0Items,
      newL1Items,
      retriedWithReflectionCount,
      compressionMutatedTo,
      compactedTurnCount,
      previousCursor,
      newCursor,
      metrics: sumMetrics(allMetrics),
    };
  }

  /**
   * Non-destructively reads committed turns from an Actor's live Penguin Route Session
   * and executes incremental background compaction (`compactTurnStream`).
   */
  public async compactRouteSession(
    routeSessionId: string,
    state: CompanionCognitiveState,
    options?: {
      tracePathOverride?: string;
      boundaryOptions?: BoundaryDetectorOptions;
      refreshRouteSessionContext?: boolean;
    },
  ): Promise<CompactionRunResult> {
    let tracePaths: string[] = [];
    let resolvedSessionId = routeSessionId;

    if (options?.tracePathOverride) {
      tracePaths = [options.tracePathOverride];
    } else {
      const meta = await this.client.resolveRouteSession(state.agentId, routeSessionId);
      resolvedSessionId = meta.sessionId || routeSessionId;
      if (meta.traceShardPaths && meta.traceShardPaths.length > 0) {
        tracePaths = meta.traceShardPaths;
      } else if (meta.tracePath) {
        tracePaths = [meta.tracePath];
      }
    }

    const existingPaths = tracePaths.filter((p) => p && fs.existsSync(p));
    if (existingPaths.length === 0) {
      return {
        newL0Items: [],
        newL1Items: [],
        retriedWithReflectionCount: 0,
        compactedTurnCount: 0,
        previousCursor: state.sessionTurnCursors[resolvedSessionId] ?? 0,
        newCursor: state.sessionTurnCursors[resolvedSessionId] ?? 0,
        metrics: sumMetrics([]),
      };
    }

    const combinedTraceContent = existingPaths
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");
    const turns = parseSessionTraceTurns(combinedTraceContent, {
      sessionId: resolvedSessionId,
      defaultSender: state.protagonistName,
    });

    const result = await this.compactTurnStream(turns, state, {
      sessionKey: resolvedSessionId,
      boundaryOptions: options?.boundaryOptions,
    });

    if (
      options?.refreshRouteSessionContext &&
      !options?.tracePathOverride &&
      result.newL0Items.length > 0
    ) {
      await this.client
        .triggerRouteSessionContextRefresh(resolvedSessionId, state.agentId)
        .catch(() => false);
    }

    return result;
  }
}
