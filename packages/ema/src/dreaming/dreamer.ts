/**
 * @prism-shadow/ema - Dreaming & Parallel Background Consolidation Engine (RFC-0007)
 *
 * Implements the three-phase self-supervised `dreaming` loop, capable of running both
 * during circadian sleep cycles AND continuously in parallel with an Actor's foreground
 * Route Session without blocking inbound messages:
 *
 * - Phase 1 (Background Memory Compaction & Cross-Scene Fact Consolidation):
 *   Incrementally compacts uncompacted Route Session turns into L0 `SceneMemoryIndexItem`s,
 *   deduplicates `keyFacts` across scenes, and triggers L0 -> L1 hierarchical rollup.
 * - Phase 2 (Hindsight Evaluation, Anti-OOC Drift Audit & Anchor-Preserving Evolution):
 *   Evaluates daytime scenes using subsequent user reactions (`Input_{t+1..t+k}`) and
 *   synthesizes counterfactual targets `<OS_t^*, a_t^dream>`. Mutates P_{u,v} -> P_{u+1,0}
 *   using Anchor-Preserving Modulation when drift or low scores are observed.
 * - Phase 3 (Counterfactual Dream Replay & Anchor Regression Gate):
 *   Replays the counterfactual scene window (and optional anchor benchmark scenes) under
 *   candidate P'; commits to `AGENTS.md` if and only if replay quality improves AND
 *   anchor benchmark score stays above threshold.
 */

import type {
  CompanionCognitiveState,
  DreamCycleResult,
  LiveConversationTurn,
  LlmCallMetrics,
  MemoryItem,
  SceneWindow,
} from "../cognition/types.js";
import {
  type LlmCallOptions,
  PenguinServerLLMClient,
  sumMetrics,
} from "../cognition/llm-client.js";
import {
  mutatePersonalityWithAnchors,
  syncCompanionAgentState,
} from "../cognition/persona-mutator.js";
import {
  evaluateScenePredictionsWithTarget,
  runCompanionSceneForward,
} from "../cognition/forward.js";
import {
  readColdArchiveRecords,
  saveCognitiveState,
} from "../compaction/archive-store.js";
import {
  EmaMemoryCompactor,
  type EmaCompactorConfig,
} from "../compaction/compactor.js";
import { evaluateSceneInHindsight } from "./hindsight-evaluator.js";

export interface EmaDreamerConfig {
  targetCharacter: string;
  protagonistCharacter?: string;
  studentModel?: {
    provider: string;
    modelId: string;
    thinkingLevel: "low" | "medium" | "high";
  };
  teacherModel?: {
    provider: string;
    modelId: string;
    thinkingLevel: "low" | "medium" | "high";
  };
  companionAgentId: string;
  evaluatorAgentId?: string;
  /** Daytime mean score threshold below which persona mutation is triggered (default: 84) */
  mutationScoreThreshold?: number;
  /** Minimum acceptable score on anchor regression benchmark scenes (default: 78) */
  anchorMinScore?: number;
  /** Force persona refinement even if daytime score is above threshold (useful for consolidating new relational bonds) */
  forcePersonaRefinement?: boolean;
  /** Maximum un-dreamed scenes to evaluate in a single dream cycle (default: 3) */
  maxScenesPerDreamCycle?: number;
  /** SQLite database file path for persistent cold memory archive */
  archiveDbPath?: string;
  /** @deprecated Alias for archiveDbPath */
  archiveJsonlPath?: string;
  statePath?: string;
  syncAgentOnDisk?: boolean;
  compactorConfig?: Partial<EmaCompactorConfig>;
}

export class EmaDreamEngine {
  public readonly config: Required<
    Pick<
      EmaDreamerConfig,
      | "targetCharacter"
      | "protagonistCharacter"
      | "companionAgentId"
      | "evaluatorAgentId"
      | "mutationScoreThreshold"
      | "anchorMinScore"
      | "forcePersonaRefinement"
      | "maxScenesPerDreamCycle"
      | "syncAgentOnDisk"
    >
  > &
    EmaDreamerConfig;

  public readonly client: PenguinServerLLMClient;
  public readonly compactor: EmaMemoryCompactor;

  constructor(
    config: EmaDreamerConfig,
    options?: {
      client?: PenguinServerLLMClient;
      compactor?: EmaMemoryCompactor;
    },
  ) {
    this.config = {
      ...config,
      targetCharacter: config.targetCharacter || "Companion",
      protagonistCharacter: config.protagonistCharacter || "Owner",
      evaluatorAgentId: config.evaluatorAgentId || "ema_minimal",
      mutationScoreThreshold: config.mutationScoreThreshold ?? 84,
      anchorMinScore: config.anchorMinScore ?? 78,
      forcePersonaRefinement: config.forcePersonaRefinement ?? false,
      maxScenesPerDreamCycle: config.maxScenesPerDreamCycle ?? 3,
      syncAgentOnDisk: config.syncAgentOnDisk ?? true,
      studentModel: config.studentModel || {
        provider: "penguin-go",
        modelId: "gemini-3.8-flash",
        thinkingLevel: "medium",
      },
      teacherModel: config.teacherModel || {
        provider: "penguin-go",
        modelId: "gemini-3.8-flash",
        thinkingLevel: "medium",
      },
    };

    this.client = options?.client || new PenguinServerLLMClient();
    this.compactor =
      options?.compactor ||
      new EmaMemoryCompactor(
        {
          targetCharacter: this.config.targetCharacter,
          protagonistCharacter: this.config.protagonistCharacter,
          model: this.config.teacherModel,
          evaluatorAgentId: this.config.evaluatorAgentId,
          companionAgentId: this.config.companionAgentId,
          archiveDbPath: this.config.archiveDbPath || this.config.archiveJsonlPath,
          statePath: this.config.statePath,
          syncAgentOnDisk: false,
          ...this.config.compactorConfig,
        },
        { client: this.client },
      );
  }

  private studentCallOptions(): LlmCallOptions {
    return {
      agentId: this.config.companionAgentId,
      provider: this.config.studentModel!.provider,
      modelId: this.config.studentModel!.modelId,
      thinkingLevel: this.config.studentModel!.thinkingLevel,
    };
  }

  private teacherCallOptions(): LlmCallOptions {
    return {
      agentId: this.config.evaluatorAgentId,
      provider: this.config.teacherModel!.provider,
      modelId: this.config.teacherModel!.modelId,
      thinkingLevel: this.config.teacherModel!.thinkingLevel,
    };
  }

  private nextDreamPersonalityVersion(currentVersion: string): string {
    const match = currentVersion.match(/^P_(\d+)_(\d+)$/);
    if (match) {
      return `P_${Number(match[1]) + 1}_0`;
    }
    return `${currentVersion}_dream`;
  }

  /**
   * Deduplicates `keyFacts` across active L0 `SceneMemoryIndexItem`s so redundant facts
   * do not bloat the In-Context MemoryIndex.
   */
  public consolidateMemoryIndexFacts(state: CompanionCognitiveState): number {
    const seenNormalized = new Set<string>();
    let totalConsolidated = 0;

    for (const item of state.memoryIndex) {
      if (!Array.isArray(item.keyFacts)) continue;
      const deduped: string[] = [];
      for (const fact of item.keyFacts) {
        const norm = fact.replace(/[，。！？、；：\s]/g, "").trim();
        if (!norm) continue;
        if (!seenNormalized.has(norm)) {
          seenNormalized.add(norm);
          deduped.push(fact.trim());
          totalConsolidated++;
        }
      }
      if (deduped.length === 0 && item.keyFacts.length > 0) {
        deduped.push(item.keyFacts[0]);
      }
      item.keyFacts = deduped;
    }

    return totalConsolidated;
  }

  /**
   * Executes a complete three-phase Dreaming & Consolidation cycle (RFC-0007).
   * Safe to run in parallel with an active Route Session: all LLM calls execute in isolated
   * ephemeral worker sessions (`DELETE /api/sessions/:id`) and only atomically update
   * `state` and `AGENTS.md` after passing the Counterfactual Replay & Anchor Regression Gate.
   */
  public async runDreamCycle(
    state: CompanionCognitiveState,
    options?: {
      routeSessionId?: string;
      tracePathOverride?: string;
      liveTurns?: LiveConversationTurn[];
      anchorBenchmarkScenes?: SceneWindow[];
    },
  ): Promise<DreamCycleResult> {
    const allMetrics: LlmCallMetrics[] = [];
    const personalityVersionBefore = state.personality.version;

    // =========================================================================
    // Phase 1: Background Memory Compaction & Fact Deduplication
    // =========================================================================
    let compactionResult;
    if (options?.liveTurns && options.liveTurns.length > 0) {
      compactionResult = await this.compactor.compactTurnStream(options.liveTurns, state, {
        sessionKey: options.routeSessionId || "live",
      });
      allMetrics.push(compactionResult.metrics);
    } else if (options?.routeSessionId) {
      compactionResult = await this.compactor.compactRouteSession(
        options.routeSessionId,
        state,
        { tracePathOverride: options.tracePathOverride },
      );
      allMetrics.push(compactionResult.metrics);
    }

    const consolidatedFactCount = this.consolidateMemoryIndexFacts(state);

    // Gather un-dreamed scene trajectories from SQLite cold archive (or synthesize from recent L0 items)
    const archiveDbPath = this.config.archiveDbPath || this.config.archiveJsonlPath;
    const archivedRecords = archiveDbPath
      ? readColdArchiveRecords(archiveDbPath)
      : [];
    const dreamedSet = new Set(state.dreamedSceneIds || []);

    const candidateScenes: Array<{
      sceneId: string;
      title: string;
      setting: string;
      items: MemoryItem[];
    }> = [];

    for (const rec of archivedRecords) {
      if (!dreamedSet.has(rec.sceneId) && rec.items && rec.items.length > 0) {
        candidateScenes.push({
          sceneId: rec.sceneId,
          title: rec.title,
          setting: rec.setting,
          items: rec.items,
        });
      }
    }

    // Fallback if no cold archive file was used: construct synthetic items from un-dreamed L0 scenes
    if (candidateScenes.length === 0) {
      for (const l0 of state.memoryIndex) {
        if (!dreamedSet.has(l0.sceneId)) {
          candidateScenes.push({
            sceneId: l0.sceneId,
            title: l0.title,
            setting: l0.setting,
            items: [
              {
                turnId: `${l0.sceneId}#turn-01`,
                sceneId: l0.sceneId,
                turnIndexInScene: 1,
                inputText: `【${state.protagonistName}】: （在 ${l0.setting} 与 ${this.config.targetCharacter} 交流《${l0.title}》相关的话题）`,
                predictedOS: l0.innerOSArc,
                committedOS: l0.innerOSArc,
                predictedAction: l0.summary,
                gtActionText: l0.summary,
                osConsistent: true,
                osScore: 85,
                actionScore: 85,
                combinedScore: 85,
                diagnostic: "Synthesized from SceneMemoryIndexItem",
              },
            ],
          });
        }
      }
    }

    const scenesToDream = candidateScenes.slice(-this.config.maxScenesPerDreamCycle);

    // =========================================================================
    // Phase 2: Hindsight Self-Evaluation & Anti-OOC Drift Audit
    // =========================================================================
    let totalScoreSum = 0;
    let evaluatedTurnCount = 0;
    let driftFailureCount = 0;
    let worstSceneForReplay: {
      counterfactualScene: SceneWindow;
      calibratedItems: MemoryItem[];
      meanScore: number;
    } | null = null;

    for (const sc of scenesToDream) {
      const hindsight = await evaluateSceneInHindsight({
        client: this.client,
        teacherCallOptions: this.teacherCallOptions(),
        targetCharacter: this.config.targetCharacter,
        protagonistCharacter: state.protagonistName,
        currentPersonality: state.personality,
        anchorPersonality: state.anchorPersonality,
        sceneId: sc.sceneId,
        sceneTitle: sc.title,
        sceneSetting: sc.setting,
        items: sc.items,
      });
      allMetrics.push(...hindsight.metrics);

      const sceneMean =
        hindsight.calibratedItems.reduce((s, x) => s + x.combinedScore, 0) /
        Math.max(1, hindsight.calibratedItems.length);

      for (const ev of hindsight.evaluations) {
        totalScoreSum += ev.combinedScore;
        evaluatedTurnCount++;
        if (ev.driftDetected) driftFailureCount++;
      }

      // Enrich the L0 memory index item's innerOSArc with hindsight-calibrated OS if available
      const matchingL0 = state.memoryIndex.find((m) => m.sceneId === sc.sceneId);
      if (matchingL0 && hindsight.evaluations.length > 0) {
        const refinedOS = hindsight.evaluations[hindsight.evaluations.length - 1].synthesizedDreamOS;
        if (refinedOS && refinedOS.length <= 80) {
          matchingL0.innerOSArc = refinedOS;
        }
      }

      if (!worstSceneForReplay || sceneMean < worstSceneForReplay.meanScore) {
        worstSceneForReplay = {
          counterfactualScene: hindsight.counterfactualScene,
          calibratedItems: hindsight.calibratedItems,
          meanScore: sceneMean,
        };
      }

      state.dreamedSceneIds.push(sc.sceneId);
    }

    const meanDaytimeScore =
      evaluatedTurnCount > 0 ? Number((totalScoreSum / evaluatedTurnCount).toFixed(1)) : 88.0;

    // =========================================================================
    // Phase 3: Anchor-Preserving Persona Evolution & Counterfactual Replay Gate
    // =========================================================================
    let personalityMutated = false;
    let mutationReason: string | undefined;
    let replayScoreBefore: number | undefined;
    let replayScoreAfter: number | undefined;
    let anchorBenchmarkScore: number | undefined;
    let gatePassed = true;

    const shouldAttemptMutation =
      worstSceneForReplay !== null &&
      (meanDaytimeScore < this.config.mutationScoreThreshold ||
        driftFailureCount > 0 ||
        this.config.forcePersonaRefinement);

    if (shouldAttemptMutation && worstSceneForReplay) {
      replayScoreBefore = Number(worstSceneForReplay.meanScore.toFixed(1));
      const nextVersionLabel = this.nextDreamPersonalityVersion(state.personality.version);

      const mutated = await mutatePersonalityWithAnchors({
        client: this.client,
        teacherCallOptions: this.teacherCallOptions(),
        targetCharacter: this.config.targetCharacter,
        currentPersonality: state.personality,
        anchorPersonality: state.anchorPersonality,
        scene: worstSceneForReplay.counterfactualScene,
        items: worstSceneForReplay.calibratedItems,
        nextVersionLabel,
        mode: "dreaming",
      });
      allMetrics.push(mutated.metrics);
      mutationReason = mutated.mutationReason;

      // Counterfactual Dream Replay under candidate P'
      const replayForward = await runCompanionSceneForward({
        client: this.client,
        studentCallOptions: this.studentCallOptions(),
        targetCharacter: this.config.targetCharacter,
        protagonistCharacter: state.protagonistName,
        personality: mutated.mutatedPersonality,
        memoryIndex: state.memoryIndex,
        l1MemoryIndex: state.l1MemoryIndex,
        scene: worstSceneForReplay.counterfactualScene,
        batchSize: 6,
        syncAgentOnDisk: false,
      });
      allMetrics.push(...replayForward.metrics);

      const replayEval = await evaluateScenePredictionsWithTarget({
        client: this.client,
        teacherCallOptions: this.teacherCallOptions(),
        targetCharacter: this.config.targetCharacter,
        personality: mutated.mutatedPersonality,
        scene: worstSceneForReplay.counterfactualScene,
        predictions: replayForward.predictions,
      });
      allMetrics.push(...replayEval.metrics);

      replayScoreAfter = Number(
        (
          replayEval.items.reduce((s, x) => s + x.combinedScore, 0) /
          Math.max(1, replayEval.items.length)
        ).toFixed(1),
      );

      // Optional Anchor Regression Benchmark Gate
      const benchmarkScenes =
        options?.anchorBenchmarkScenes || state.anchorBenchmarkScenes || [];
      let anchorOk = true;
      if (benchmarkScenes.length > 0) {
        const anchorScene = benchmarkScenes[0];
        const anchorFwd = await runCompanionSceneForward({
          client: this.client,
          studentCallOptions: this.studentCallOptions(),
          targetCharacter: this.config.targetCharacter,
          protagonistCharacter: state.protagonistName,
          personality: mutated.mutatedPersonality,
          memoryIndex: state.memoryIndex,
          l1MemoryIndex: state.l1MemoryIndex,
          scene: anchorScene,
          batchSize: 6,
          syncAgentOnDisk: false,
        });
        allMetrics.push(...anchorFwd.metrics);

        const anchorEv = await evaluateScenePredictionsWithTarget({
          client: this.client,
          teacherCallOptions: this.teacherCallOptions(),
          targetCharacter: this.config.targetCharacter,
          personality: mutated.mutatedPersonality,
          scene: anchorScene,
          predictions: anchorFwd.predictions,
        });
        allMetrics.push(...anchorEv.metrics);

        anchorBenchmarkScore = Number(
          (
            anchorEv.items.reduce((s, x) => s + x.combinedScore, 0) /
            Math.max(1, anchorEv.items.length)
          ).toFixed(1),
        );
        anchorOk = anchorBenchmarkScore >= this.config.anchorMinScore;
      }

      gatePassed = replayScoreAfter >= replayScoreBefore && anchorOk;

      if (gatePassed) {
        const lastHist =
          mutated.mutatedPersonality.mutationHistory[
            mutated.mutatedPersonality.mutationHistory.length - 1
          ];
        if (lastHist) {
          lastHist.scoreAfter = replayScoreAfter;
        }
        state.personality = mutated.mutatedPersonality;
        personalityMutated = true;
      }
    }

    if (this.config.statePath) {
      saveCognitiveState(this.config.statePath, state);
    }

    let syncedAgentsMdPath: string | undefined;
    if (this.config.syncAgentOnDisk) {
      const synced = syncCompanionAgentState({
        personality: state.personality,
        memoryIndex: state.memoryIndex,
        l1MemoryIndex: state.l1MemoryIndex,
        agentId: this.config.companionAgentId,
        protagonistName: state.protagonistName,
        thinkingLevel: this.config.studentModel?.thinkingLevel,
      });
      syncedAgentsMdPath = synced.agentsMdPath;

      if (options?.routeSessionId && !options?.tracePathOverride) {
        await this.client
          .triggerRouteSessionContextRefresh(
            options.routeSessionId,
            this.config.companionAgentId,
          )
          .catch(() => false);
      }
    }

    return {
      agentId: this.config.companionAgentId,
      routeSessionId: options?.routeSessionId,
      compactionResult,
      evaluatedSceneCount: scenesToDream.length,
      evaluatedTurnCount,
      meanDaytimeScore,
      driftFailureCount,
      consolidatedFactCount,
      personalityVersionBefore,
      personalityVersionAfter: state.personality.version,
      personalityMutated,
      mutationReason,
      replayScoreBefore,
      replayScoreAfter,
      anchorBenchmarkScore,
      gatePassed,
      syncedAgentsMdPath,
      metrics: sumMetrics(allMetrics),
    };
  }
}

export interface ParallelRouteSessionConsolidatorOptions {
  dreamer: EmaDreamEngine;
  state: CompanionCognitiveState;
  routeSessionId: string;
  tracePathOverride?: string;
  /** Polling interval in ms to check the Route Session for new turns (default: 10000) */
  pollIntervalMs?: number;
  /** Minimum new uncompacted turns before triggering background compact (default: 2) */
  minNewTurnsForCompact?: number;
  /** Trigger a full Dreaming cycle every N newly compacted scenes (default: 2) */
  dreamEveryNScenes?: number;
  onCompact?: (res: DreamCycleResult["compactionResult"]) => void;
  onDream?: (res: DreamCycleResult) => void;
}

export interface ParallelRouteSessionConsolidatorHandle {
  /** Triggers an immediate background tick (non-overlapping FIFO) */
  tickNow: () => Promise<DreamCycleResult | null>;
  /** Stops the background polling timer */
  dispose: () => void;
}

/**
 * Attaches a non-blocking background compaction & dreaming worker in parallel with an
 * Actor's foreground Route Session (RFC-0007).
 *
 * The foreground Route Session receives user/channel messages normally, while this
 * worker inspects the Route Session's trace in the background, runs incremental `compact`
 * and periodic `dreaming` inside isolated ephemeral worker sessions, and atomically
 * updates `AGENTS.md`.
 */
export function startParallelRouteSessionConsolidator(
  options: ParallelRouteSessionConsolidatorOptions,
): ParallelRouteSessionConsolidatorHandle {
  const {
    dreamer,
    state,
    routeSessionId,
    tracePathOverride,
    pollIntervalMs = 10_000,
    minNewTurnsForCompact = 2,
    dreamEveryNScenes = 2,
    onCompact,
    onDream,
  } = options;

  let disposed = false;
  let pendingScenesSinceLastDream = 0;
  let runningChain: Promise<DreamCycleResult | null> = Promise.resolve(null);

  const executeTick = async (): Promise<DreamCycleResult | null> => {
    if (disposed) return null;

    const compacted = await dreamer.compactor.compactRouteSession(routeSessionId, state, {
      tracePathOverride,
      boundaryOptions: {
        minTurnsToFlush: minNewTurnsForCompact,
        flushTrailing: true,
      },
    });

    if (compacted.newL0Items.length > 0) {
      pendingScenesSinceLastDream += compacted.newL0Items.length;
      if (dreamer.config.syncAgentOnDisk) {
        syncCompanionAgentState({
          personality: state.personality,
          memoryIndex: state.memoryIndex,
          l1MemoryIndex: state.l1MemoryIndex,
          agentId: dreamer.config.companionAgentId,
          protagonistName: state.protagonistName,
        });
      }
      onCompact?.(compacted);
    }

    if (pendingScenesSinceLastDream >= dreamEveryNScenes) {
      pendingScenesSinceLastDream = 0;
      const dreamRes = await dreamer.runDreamCycle(state, {
        routeSessionId,
        tracePathOverride,
      });
      dreamRes.compactionResult = compacted;
      onDream?.(dreamRes);
      return dreamRes;
    }

    return null;
  };

  const tickNow = (): Promise<DreamCycleResult | null> => {
    runningChain = runningChain
      .then(() => executeTick())
      .catch((err) => {
        console.error(`[EMA Parallel Consolidator] Background tick error:`, err);
        return null;
      });
    return runningChain;
  };

  const timer = setInterval(() => {
    void tickNow();
  }, pollIntervalMs);

  return {
    tickNow,
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}
