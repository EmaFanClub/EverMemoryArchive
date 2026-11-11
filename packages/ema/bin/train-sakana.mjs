#!/usr/bin/env node

/**
 * Sakana Dual-Variant 1-Round Persona & Memory Training Runner
 *
 * Usage:
 *   node packages/ema/bin/train-sakana.mjs [sakana-kawaii] [sakana-chan]
 *
 * Default order (per user instruction):
 *   1. sakana-kawaii (温软乖巧版 / 温柔人格)
 *   2. sakana-chan (经典微屑傲娇版 / 傲娇人格)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "../../use-ema/node_modules/smol-toml/dist/index.js";
import {
  EmaPersonaTrainer,
  buildPersonaTomlDataset,
  filterPostTrainingMemoryIndex,
  renderCompanionAgentsMd,
  sumMetrics,
  syncCompanionAgentState,
} from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PERSONAS_DIR = path.join(REPO_ROOT, "personas");

const VARIANT_CONFIG = {
  "sakana-kawaii": {
    agentId: "sakana_kawaii",
    label: "大肥鱼 (温软乖巧版 / Sakana-kawaii)",
    rsiScoreThreshold: 78,
  },
  "sakana-chan": {
    agentId: "sakana_chan",
    label: "大肥鱼 (经典微屑傲娇版 / Sakana-chan)",
    rsiScoreThreshold: 78,
  },
};

function computeTrackSummary(results) {
  if (results.length === 0) {
    return {
      sceneCount: 0,
      turnCount: 0,
      initialMeanScore: 0,
      finalMeanScore: 0,
      meanOsScore: 0,
      meanActionScore: 0,
      osConsistencyRate: 0,
    };
  }
  const allItems = results.flatMap((r) => r.items);
  const totalTurns = Math.max(1, allItems.length);
  const initialWeighted =
    results.reduce((s, r) => s + r.initialMeanScore * r.turnCount, 0) / totalTurns;
  const finalWeighted =
    results.reduce((s, r) => s + r.finalMeanScore * r.turnCount, 0) / totalTurns;
  const meanOsScore = allItems.reduce((s, it) => s + it.osScore, 0) / totalTurns;
  const meanActionScore = allItems.reduce((s, it) => s + it.actionScore, 0) / totalTurns;
  const osConsistentCount = allItems.filter((it) => it.osConsistent).length;

  return {
    sceneCount: results.length,
    turnCount: allItems.length,
    initialMeanScore: Number(initialWeighted.toFixed(1)),
    finalMeanScore: Number(finalWeighted.toFixed(1)),
    meanOsScore: Number(meanOsScore.toFixed(1)),
    meanActionScore: Number(meanActionScore.toFixed(1)),
    osConsistencyRate: Number((osConsistentCount / totalTurns).toFixed(3)),
  };
}

async function trainOneVariant(personaId) {
  const startedAt = Date.now();
  const cfg = VARIANT_CONFIG[personaId];
  if (!cfg) {
    throw new Error(`Unknown persona variant: ${personaId}`);
  }

  const personaPath = path.join(PERSONAS_DIR, personaId);
  const rawPersonaToml = fs.readFileSync(path.join(personaPath, "persona.toml"), "utf8");
  const rawChaptersToml = fs.readFileSync(
    path.join(personaPath, "script", "chapters.toml"),
    "utf8",
  );
  const rawAutonomyToml = fs.readFileSync(
    path.join(personaPath, "script", "autonomy.toml"),
    "utf8",
  );

  const bundle = buildPersonaTomlDataset({
    personaId,
    parsedPersonaToml: parseToml(rawPersonaToml),
    parsedChaptersToml: parseToml(rawChaptersToml),
    parsedAutonomyToml: parseToml(rawAutonomyToml),
  });

  console.log(`\n==================================================================`);
  console.log(`[Train Start] ${cfg.label} (${personaId})`);
  console.log(`  Target Agent ID:  ${cfg.agentId}`);
  console.log(`  Total Scenes:     ${bundle.washedDataset.scenes.length} (12 daily + 8 autonomy)`);
  console.log(`  Total Turns:      ${bundle.washedDataset.stats.totalTurnBundles}`);
  console.log(`  Explicit <OS>:    ${bundle.washedDataset.stats.explicitTargetMonologues}`);
  console.log(`  RSI Threshold:    ${cfg.rsiScoreThreshold}`);
  console.log(`==================================================================\n`);

  const trainer = new EmaPersonaTrainer(
    {
      targetCharacter: bundle.targetCharacter,
      protagonistCharacter: bundle.protagonistCharacter,
      companionAgentId: cfg.agentId,
      teacherAgentId: "ema_minimal",
      studentModel: {
        provider: "penguin-go",
        modelId: "gemini-3.8-flash",
        thinkingLevel: "low",
      },
      teacherModel: {
        provider: "penguin-go",
        modelId: "gemini-3.8-flash",
        thinkingLevel: "low",
      },
      rsiScoreThreshold: cfg.rsiScoreThreshold,
      maxWindowAttempts: 2,
      studentBatchSize: 4,
      useSelfRolloutHistory: true,
      enableReflectionCheck: false,
      syncAgentOnDisk: true,
    },
    {
      initialPersonality: bundle.initialPersonality,
    },
  );

  const mutationCounter = { count: 0 };
  const results = [];
  const stageMutationMetrics = [];
  const checkpointPath = path.join(personaPath, "trained-checkpoint.json");

  // Stage boundaries for stage-level RSI consolidation:
  // Stage 1: chapter_05 (Peer Lore), Stage 2: chapter_12 (Companion Daily), Stage 3: autonomy_08 (Situational Autonomy)
  const stageBoundaries = new Map([
    ["chapter_05", { stageName: "Stage I (同温层身世与克劳德羁绊)", startIdx: 0 }],
    ["chapter_12", { stageName: "Stage II (桌面日常陪伴与情感救赎)", startIdx: 5 }],
    ["autonomy_08", { stageName: "Stage III (情境驱动自主意识四维专项)", startIdx: 12 }],
  ]);

  for (let i = 0; i < bundle.washedDataset.scenes.length; i++) {
    const scene = bundle.washedDataset.scenes[i];
    const meta = bundle.sceneMetadata[scene.sceneId];
    const sceneStart = Date.now();
    const res = await trainer.trainSceneWindow(scene, mutationCounter);
    results.push(res);

    const sec = ((Date.now() - sceneStart) / 1000).toFixed(1);
    const mutTag = res.personalityMutatedTo
      ? ` [Window RSI -> ${res.personalityMutatedTo}]`
      : "";
    console.log(
      `[${personaId} ${String(i + 1).padStart(2, "0")}/${bundle.washedDataset.scenes.length}] ` +
        `${scene.sceneId} (${meta?.track || "daily"}/${meta?.memoryScope || ""}) | ` +
        `turns=${res.turnCount} | score: ${res.initialMeanScore} -> ${res.finalMeanScore} ` +
        `(OS=${res.meanOsScore}, Act=${res.meanActionScore}) | ` +
        `P=${trainer.personality.version}${mutTag} | ${sec}s | $${res.metrics.costUsd.toFixed(4)}`,
    );

    // Stage-level RSI consolidation at curriculum boundaries (with real holdout/anchor scene validation)
    const boundary = stageBoundaries.get(scene.sceneId);
    if (boundary) {
      const stageSlice = results.slice(boundary.startIdx, i + 1);
      const stageItems = stageSlice.flatMap((r) => r.items);
      const stageMean =
        stageItems.reduce((s, it) => s + it.combinedScore, 0) /
        Math.max(1, stageItems.length);
      const hasLowTurns = stageItems.some((it) => it.combinedScore < cfg.rsiScoreThreshold);

      if (hasLowTurns || stageMean < 86) {
        mutationCounter.count++;
        const nextVer =
          scene.sceneId === "autonomy_08" ? "P_1_0" : `P_0_${mutationCounter.count}`;
        const prevPersonality = structuredClone(trainer.personality);
        const mutRes = await trainer.mutatePersonalityFromWindow(
          {
            ...scene,
            sceneId: `${scene.sceneId}_stage_consolidation`,
            title: boundary.stageName,
          },
          stageItems,
          nextVer,
        );
        stageMutationMetrics.push(mutRes.metrics);

        // Validate candidate consolidated personality on a multi-turn anchor scene
        // (for Stage III autonomy_08, validate on daily scene chapter_07 to prevent daily-chat regression)
        const valSceneIdx =
          scene.sceneId === "autonomy_08"
            ? bundle.washedDataset.scenes.findIndex((s) => s.sceneId === "chapter_07")
            : i;
        const valScene =
          valSceneIdx >= 0 ? bundle.washedDataset.scenes[valSceneIdx] : scene;
        const baselineValResult = results[valSceneIdx >= 0 ? valSceneIdx : i];
        const baselineValScore = baselineValResult
          ? baselineValResult.finalMeanScore
          : stageMean;

        trainer.personality = mutRes.mutatedPersonality;
        const valFwd = await trainer.runStudentSceneForward(valScene);
        stageMutationMetrics.push(...valFwd.metrics);
        const valEval = await trainer.evaluateScenePredictions(
          valScene,
          valFwd.predictions,
        );
        stageMutationMetrics.push(...valEval.metrics);
        const valScore =
          valEval.items.reduce((s, it) => s + it.combinedScore, 0) /
          Math.max(1, valEval.items.length);

        const lastHist =
          mutRes.mutatedPersonality.mutationHistory[
            mutRes.mutatedPersonality.mutationHistory.length - 1
          ];
        if (lastHist) {
          lastHist.scoreBefore = Number(baselineValScore.toFixed(1));
          lastHist.scoreAfter = Number(valScore.toFixed(1));
        }

        if (valScore >= baselineValScore - 0.5) {
          trainer.personality = mutRes.mutatedPersonality;
          console.log(
            `  ↳ [Stage RSI Consolidation ACCEPTED] ${boundary.stageName}: -> ${nextVer} ` +
              `(val on ${valScene.sceneId}: ${baselineValScore.toFixed(1)} -> ${valScore.toFixed(1)}) | Reason: ${mutRes.mutationReason}`,
          );
        } else {
          trainer.personality = prevPersonality;
          console.log(
            `  ↳ [Stage RSI Consolidation REJECTED] ${boundary.stageName}: kept ${prevPersonality.version} ` +
              `(val on ${valScene.sceneId}: ${baselineValScore.toFixed(1)} -> ${valScore.toFixed(1)} regressed)`,
          );
        }
      }
    }
  }

  // Finalize version label after completing 1 full round (Epoch 1)
  const finalPersonality = structuredClone(trainer.personality);
  finalPersonality.version = "P_1_0";

  // Separate Daily Track vs Autonomy Track results
  const dailyResults = results.filter(
    (r) => bundle.sceneMetadata[r.sceneId]?.track === "daily",
  );
  const autonomyResults = results.filter(
    (r) => bundle.sceneMetadata[r.sceneId]?.track === "autonomy",
  );

  const overallSummary = computeTrackSummary(results);
  const dailySummary = computeTrackSummary(dailyResults);
  const autonomySummary = computeTrackSummary(autonomyResults);

  // Apply post-training memory retention policy (`[memory_policy]`):
  // Retain 100% of `pre_meeting_peer` (Chapters 1-5) for live runtime AGENTS.md,
  // while archiving all 20 scenes in the checkpoint.
  const { retainedPeerMemoryIndex, prunedRehearsalMemoryIndex } =
    filterPostTrainingMemoryIndex(trainer.memoryIndex, bundle.sceneMetadata);

  // Sync live companion agent state (`AGENTS.md`) with P_1_0 + retainedPeerMemoryIndex
  const syncedPaths = syncCompanionAgentState({
    personality: finalPersonality,
    memoryIndex: retainedPeerMemoryIndex,
    agentId: cfg.agentId,
    protagonistName: bundle.protagonistCharacter,
    thinkingLevel: "medium",
  });

  // Also write rendered AGENTS.md into personas/<id>/AGENTS.md
  const agentsMdContent = renderCompanionAgentsMd(finalPersonality, retainedPeerMemoryIndex, {
    protagonistName: bundle.protagonistCharacter,
  });
  const personaAgentsMdPath = path.join(personaPath, "AGENTS.md");
  fs.writeFileSync(personaAgentsMdPath, agentsMdContent, "utf8");

  const totalWallClockSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  const totalMetrics = sumMetrics([
    ...results.map((r) => r.metrics),
    ...stageMutationMetrics,
  ]);

  const checkpoint = {
    personaId,
    label: cfg.label,
    agentId: cfg.agentId,
    createdAt: new Date().toISOString(),
    epochsCompleted: 1,
    totalWallClockSec,
    datasetStats: bundle.washedDataset.stats,
    overallSummary,
    dailyTrackSummary: dailySummary,
    autonomyTrackSummary: autonomySummary,
    totalMetrics,
    initialPersonality: bundle.initialPersonality,
    trainedPersonality: finalPersonality,
    memoryPolicyApplied: {
      retainedScopes: ["pre_meeting_peer"],
      prunedScopes: ["first_meeting", "companion_daily", "autonomy_track"],
      retainedCount: retainedPeerMemoryIndex.length,
      prunedCount: prunedRehearsalMemoryIndex.length,
    },
    retainedMemoryIndex: retainedPeerMemoryIndex,
    allSceneMemoryIndex: trainer.memoryIndex,
    windowResults: results,
  };

  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");

  console.log(`\n------------------------------------------------------------------`);
  console.log(`[Train Complete] ${cfg.label} (${personaId}) -> P_1_0`);
  console.log(`  Wall Clock:       ${totalWallClockSec}s | Cost: $${totalMetrics.costUsd.toFixed(4)}`);
  console.log(
    `  Overall Score:    ${overallSummary.initialMeanScore} -> ${overallSummary.finalMeanScore} (OS=${overallSummary.meanOsScore}, Action=${overallSummary.meanActionScore}, OS_Consist=${(overallSummary.osConsistencyRate * 100).toFixed(1)}%)`,
  );
  console.log(
    `  Daily Track (12): ${dailySummary.initialMeanScore} -> ${dailySummary.finalMeanScore} (${dailySummary.turnCount} turns, OS=${dailySummary.meanOsScore}, Act=${dailySummary.meanActionScore})`,
  );
  console.log(
    `  Autonomy (8):     ${autonomySummary.initialMeanScore} -> ${autonomySummary.finalMeanScore} (${autonomySummary.turnCount} turns, OS=${autonomySummary.meanOsScore}, Act=${autonomySummary.meanActionScore})`,
  );
  console.log(
    `  RSI Mutations:    ${finalPersonality.mutationHistory.length} steps`,
  );
  console.log(
    `  Memory Policy:    Retained ${retainedPeerMemoryIndex.length} pre_meeting_peer scenes (Archived ${trainer.memoryIndex.length} total)`,
  );
  console.log(`  Checkpoint:       ${checkpointPath}`);
  console.log(`  Persona AGENTS:   ${personaAgentsMdPath}`);
  console.log(`  Live Agent State: ${syncedPaths.agentsMdPath}`);
  console.log(`------------------------------------------------------------------\n`);

  return checkpoint;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const variants = args.length > 0 ? args : ["sakana-kawaii", "sakana-chan"];

  for (const v of variants) {
    await trainOneVariant(v);
  }
}

main().catch((err) => {
  console.error("Fatal training error:", err);
  process.exit(1);
});
