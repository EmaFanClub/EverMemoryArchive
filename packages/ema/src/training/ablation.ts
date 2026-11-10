/**
 * @prism-shadow/ema - Base Model & Thinking Level Ablation Harness (RFC-0003 / RFC-0005)
 *
 * Benchmarks candidate (provider, modelId, thinkingLevel) configurations on P_{0,0}
 * across warmup / early scenes to empirically select the best Student and Teacher
 * configurations based on:
 * - Format reliability (<OS> & <Action> compliance)
 * - Teacher-evaluated OS consistency & Action similarity score (0-100)
 * - Wall-clock latency (ms/turn)
 * - Token consumption & cache efficiency
 */

import type {
  CompanionPersonality,
  ModelAblationCandidate,
  ModelAblationResult,
  SceneWindow,
} from "./types.js";
import { PenguinServerLLMClient, sumMetrics } from "./llm-client.js";
import { EmaPersonaTrainer } from "./trainer.js";
import { createInitialPersonalityTemplate } from "./personality.js";

export const DEFAULT_ABLATION_CANDIDATES: ModelAblationCandidate[] = [
  {
    id: "gemini-3.8-flash@low",
    provider: "penguin-go",
    modelId: "gemini-3.8-flash",
    thinkingLevel: "low",
  },
  {
    id: "gemini-3.8-flash@medium",
    provider: "penguin-go",
    modelId: "gemini-3.8-flash",
    thinkingLevel: "medium",
  },
  {
    id: "gemini-3.8-flash@high",
    provider: "penguin-go",
    modelId: "gemini-3.8-flash",
    thinkingLevel: "high",
  },
  {
    id: "gemini-4-argon@low",
    provider: "penguin-go",
    modelId: "gemini-4-argon",
    thinkingLevel: "low",
  },
  {
    id: "gemini-4-argon@medium",
    provider: "penguin-go",
    modelId: "gemini-4-argon",
    thinkingLevel: "medium",
  },
  {
    id: "gemini-3.5-flash-lite@low",
    provider: "penguin-go",
    modelId: "gemini-3.5-flash-lite",
    thinkingLevel: "low",
  },
  {
    id: "deepseek-flash@low",
    provider: "penguin-go",
    modelId: "deepseek-flash",
    thinkingLevel: "low",
  },
  {
    id: "deepseek-v4-pro@low",
    provider: "penguin-go",
    modelId: "deepseek-v4-pro",
    thinkingLevel: "low",
  },
  {
    id: "glm-5.3-flash@low",
    provider: "free-model",
    modelId: "glm-5.3-flash",
    thinkingLevel: "low",
  },
];

export interface RunAblationOptions {
  candidates?: ModelAblationCandidate[];
  scenes: SceneWindow[];
  personality?: CompanionPersonality;
  targetCharacter?: string;
  protagonistCharacter?: string;
  teacherModel?: {
    provider: string;
    modelId: string;
    thinkingLevel: "low" | "medium" | "high";
  };
  studentBatchSize?: number;
  onCandidateResult?: (res: ModelAblationResult) => void;
}

/**
 * Evaluates each candidate model + thinking level on the same fixed personality P_{0,0}
 * and scene slice using a consistent Teacher judge.
 */
export async function runModelAndThinkingAblation(
  options: RunAblationOptions,
): Promise<ModelAblationResult[]> {
  const candidates = options.candidates || DEFAULT_ABLATION_CANDIDATES;
  const teacherModel = options.teacherModel || {
    provider: "penguin-go",
    modelId: "gemini-3.8-flash",
    thinkingLevel: "medium",
  };
  const client = new PenguinServerLLMClient();
  const results: ModelAblationResult[] = [];
  const personality =
    options.personality ||
    createInitialPersonalityTemplate({
      name: options.targetCharacter || "Companion",
      protagonistName: options.protagonistCharacter || "主角",
    });

  for (const candidate of candidates) {
    const startedAt = Date.now();
    try {
      const trainer = new EmaPersonaTrainer(
        {
          targetCharacter: options.targetCharacter || personality.name,
          protagonistCharacter: options.protagonistCharacter || "主角",
          studentModel: {
            provider: candidate.provider,
            modelId: candidate.modelId,
            thinkingLevel: candidate.thinkingLevel,
          },
          teacherModel,
          studentBatchSize: options.studentBatchSize ?? 6,
          enableReflectionCheck: false,
          syncAgentOnDisk: false,
        },
        {
          client,
          initialPersonality: personality,
        },
      );

      let totalTurns = 0;
      let validFormatTurns = 0;
      let osConsistentTurns = 0;
      let sumOsScore = 0;
      let sumActionScore = 0;
      let sumCombinedScore = 0;
      const allMetrics = [];
      const sampleOutputs: ModelAblationResult["sampleOutputs"] = [];

      for (const scene of options.scenes) {
        const fwd = await trainer.runStudentSceneForward(scene);
        allMetrics.push(...fwd.metrics);

        for (const p of fwd.predictions) {
          totalTurns++;
          if (p.formatValid) validFormatTurns++;
        }

        const evaluated = await trainer.evaluateScenePredictions(scene, fwd.predictions);
        allMetrics.push(...evaluated.metrics);

        for (const it of evaluated.items) {
          if (it.osConsistent) osConsistentTurns++;
          sumOsScore += it.osScore;
          sumActionScore += it.actionScore;
          sumCombinedScore += it.combinedScore;
          if (sampleOutputs.length < 4) {
            sampleOutputs.push({
              turnId: it.turnId,
              inputText: it.inputText,
              predictedOS: it.predictedOS,
              predictedAction: it.predictedAction,
              gtActionText: it.gtActionText,
              combinedScore: it.combinedScore,
            });
          }
        }
      }

      const totalLatencyMs = Date.now() - startedAt;
      const denom = Math.max(1, totalTurns);
      const res: ModelAblationResult = {
        candidate,
        sceneCount: options.scenes.length,
        turnCount: totalTurns,
        formatSuccessRate: Number((validFormatTurns / denom).toFixed(3)),
        osConsistencyRate: Number((osConsistentTurns / denom).toFixed(3)),
        meanOsScore: Number((sumOsScore / denom).toFixed(1)),
        meanActionScore: Number((sumActionScore / denom).toFixed(1)),
        meanCombinedScore: Number((sumCombinedScore / denom).toFixed(1)),
        totalLatencyMs,
        msPerTurn: Math.round(totalLatencyMs / denom),
        metrics: sumMetrics(allMetrics),
        sampleOutputs,
      };
      results.push(res);
      options.onCandidateResult?.(res);
    } catch (err: any) {
      const totalLatencyMs = Date.now() - startedAt;
      const res: ModelAblationResult = {
        candidate,
        sceneCount: options.scenes.length,
        turnCount: 0,
        formatSuccessRate: 0,
        osConsistencyRate: 0,
        meanOsScore: 0,
        meanActionScore: 0,
        meanCombinedScore: 0,
        totalLatencyMs,
        msPerTurn: 0,
        metrics: {
          latencyMs: totalLatencyMs,
          promptTokens: 0,
          cachedTokens: 0,
          thoughtsTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        },
        sampleOutputs: [],
        error: err?.message || String(err),
      };
      results.push(res);
      options.onCandidateResult?.(res);
    }
  }

  return results;
}
