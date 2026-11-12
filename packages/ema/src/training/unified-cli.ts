/**
 * @prism-shadow/ema - Unified Single-TOML Training, Washing & Persona CLI Engine
 *
 * Provides a streamlined 3-command workflow driven by a single TOML config file (`persona.toml`):
 * 1. `washDatasetFromConfig` (`ema wash --config <persona.toml> --prompt "<what to wash>"`)
 * 2. `trainFromConfig`       (`ema train --config <persona.toml> --prompt "<training focus>"`)
 * 3. `managePersonaFromConfig` (`ema persona --config <persona.toml> [show|sync|init] [--prompt "<directive>"]`)
 */

import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  CompanionPersonality,
  LlmCallMetrics,
  SceneMemoryIndexItem,
  WashedDataset,
  WindowTrainingResult,
} from "../cognition/types.js";
import { PenguinServerLLMClient, sumMetrics } from "../cognition/llm-client.js";
import {
  renderCompanionAgentsMd,
  syncCompanionAgentState,
} from "../cognition/persona-mutator.js";
import { installWebWorkbench } from "../worlds/web/workbench.js";
import {
  buildInitialPersonalityFromPersonaToml,
  buildPersonaTomlDataset,
  filterPostTrainingMemoryIndex,
  type PersonaTomlBundle,
} from "./persona-toml.js";
import { loadGalgameDataset } from "./dataset.js";
import { EmaPersonaTrainer } from "./trainer.js";

export interface UnifiedPersonaConfig {
  /** Absolute path to the single TOML configuration file */
  configFile: string;
  /** Directory containing the TOML configuration file */
  personaDir: string;
  /** Raw parsed TOML object */
  parsedToml: Record<string, any>;
  /** Persona identifier (e.g. "sakana-kawaii") */
  personaId: string;
  /** Penguin agent identifier (e.g. "sakana_kawaii") */
  agentId: string;
  /** Target companion character name in scripts (e.g. "大肥鱼") */
  targetCharacter: string;
  /** Protagonist / user character name in scripts (e.g. "主人") */
  protagonistCharacter: string;
  /** Resolved path to `script/chapters.toml` */
  chaptersTomlPath: string;
  /** Resolved path to `script/autonomy.toml` */
  autonomyTomlPath: string;
  /** Optional raw Galgame script JSON path if configured via `[dataset].raw_input` */
  rawInputPath?: string;
  /** Output path for the washed dataset JSON */
  washedDatasetPath: string;
  /** Output path for the trained checkpoint JSON */
  checkpointPath: string;
  /** Output path for the compiled AGENTS.md in the persona directory */
  agentsMdPath: string;
  /** Training hyperparameters resolved from `[training]` with defaults */
  training: {
    provider: string;
    studentModel: string;
    teacherModel: string;
    thinkingLevel: "low" | "medium" | "high";
    rsiScoreThreshold: number;
    maxWindowAttempts: number;
    studentBatchSize: number;
    maxScenes?: number;
    syncAgent: boolean;
    useSelfRolloutHistory: boolean;
  };
}

export interface WashedBundleArtifact {
  schemaVersion: "1.0";
  configFile: string;
  personaId: string;
  targetCharacter: string;
  protagonistCharacter: string;
  washPrompt: string;
  washedAt: string;
  initialPersonality: CompanionPersonality;
  washedDataset: WashedDataset;
  sceneMetadata: PersonaTomlBundle["sceneMetadata"];
  stats: {
    totalScenes: number;
    totalTurns: number;
    turnsWithExplicitOS: number;
    goldenExemplarCount: number;
  };
}

export interface WashCommandResult {
  configFile: string;
  washedDatasetPath: string;
  personaId: string;
  targetCharacter: string;
  protagonistCharacter: string;
  washPrompt: string;
  totalScenes: number;
  totalTurns: number;
  turnsWithExplicitOS: number;
  goldenExemplarCount: number;
  artifact: WashedBundleArtifact;
}

export interface TrainCommandResult {
  configFile: string;
  checkpointPath: string;
  agentsMdPath: string;
  personaId: string;
  agentId: string;
  trainPrompt: string;
  trainedSceneCount: number;
  initialMeanScore: number;
  finalMeanScore: number;
  finalPersonalityVersion: string;
  retainedMemoryCount: number;
  prunedMemoryCount: number;
  syncedAgentPath?: string;
  metrics: LlmCallMetrics;
  results: WindowTrainingResult[];
}

export interface PersonaCommandResult {
  action: "show" | "init" | "sync";
  configFile: string;
  personaId: string;
  agentId: string;
  displayName: string;
  summary: string;
  traitCount: number;
  invariantCount: number;
  chaptersCount: number;
  autonomyChaptersCount: number;
  checkpointExists: boolean;
  checkpointVersion?: string;
  agentsMdPath: string;
  syncedAgentPath?: string;
  workbenchInstalled?: boolean;
}

/**
 * Resolves and parses the single unified TOML configuration file.
 * If `configPath` points to a directory, automatically resolves `<configPath>/persona.toml`.
 */
export function loadUnifiedTomlConfig(configPath: string): UnifiedPersonaConfig {
  const absInput = path.resolve(configPath);
  const configFile =
    fs.existsSync(absInput) && fs.statSync(absInput).isDirectory()
      ? path.join(absInput, "persona.toml")
      : absInput;

  if (!fs.existsSync(configFile)) {
    throw new Error(`Config TOML file not found: ${configFile}`);
  }

  const rawToml = fs.readFileSync(configFile, "utf8");
  const parsedToml = parseToml(rawToml) as Record<string, any>;
  const personaDir = path.dirname(configFile);

  const personaSection = parsedToml.persona || {};
  const datasetSection = parsedToml.dataset || {};
  const trainingSection = parsedToml.training || {};
  const autonomySection = parsedToml.autonomy_rubric || {};

  const personaId = String(personaSection.id || path.basename(personaDir));
  const agentId = String(
    trainingSection.agent_id ||
      personaSection.agent_id ||
      personaId.replace(/[^a-zA-Z0-9_]/g, "_"),
  );

  const targetCharacter = String(
    datasetSection.target_character || personaSection.short_name || "大肥鱼",
  );
  const protagonistCharacter = String(datasetSection.protagonist_character || "主人");

  const chaptersRel = String(datasetSection.chapters_toml || "script/chapters.toml");
  const autonomyRel = String(
    datasetSection.autonomy_toml || autonomySection.track_file || "script/autonomy.toml",
  );
  const washedRel = String(datasetSection.washed_output || "washed-dataset.json");
  const checkpointRel = String(trainingSection.checkpoint_output || "trained-checkpoint.json");
  const agentsMdRel = String(trainingSection.agents_md_output || "AGENTS.md");

  const chaptersTomlPath = path.resolve(personaDir, chaptersRel);
  const autonomyTomlPath = path.resolve(personaDir, autonomyRel);
  const rawInputPath = datasetSection.raw_input
    ? path.resolve(personaDir, String(datasetSection.raw_input))
    : undefined;
  const washedDatasetPath = path.resolve(personaDir, washedRel);
  const checkpointPath = path.resolve(personaDir, checkpointRel);
  const agentsMdPath = path.resolve(personaDir, agentsMdRel);

  const thinkingRaw = String(trainingSection.thinking_level || "medium");
  const thinkingLevel: "low" | "medium" | "high" =
    thinkingRaw === "low" || thinkingRaw === "high" ? thinkingRaw : "medium";

  return {
    configFile,
    personaDir,
    parsedToml,
    personaId,
    agentId,
    targetCharacter,
    protagonistCharacter,
    chaptersTomlPath,
    autonomyTomlPath,
    rawInputPath,
    washedDatasetPath,
    checkpointPath,
    agentsMdPath,
    training: {
      provider: String(trainingSection.provider || "penguin-go"),
      studentModel: String(trainingSection.student_model || "gemini-3.8-flash"),
      teacherModel: String(trainingSection.teacher_model || "gemini-3.8-flash"),
      thinkingLevel,
      rsiScoreThreshold: Number(trainingSection.rsi_score_threshold ?? 85),
      maxWindowAttempts: Number(trainingSection.max_window_attempts ?? 2),
      studentBatchSize: Number(trainingSection.student_batch_size ?? 12),
      maxScenes:
        trainingSection.max_scenes !== undefined ? Number(trainingSection.max_scenes) : undefined,
      syncAgent: trainingSection.sync_agent !== false,
      useSelfRolloutHistory: Boolean(trainingSection.use_self_rollout_history ?? false),
    },
  };
}

/**
 * Applies a natural-language prompt directive to a `CompanionPersonality` seed
 * so downstream washing, training, and agent synchronization enforce it.
 */
export function applyPromptDirectiveToPersonality(
  personality: CompanionPersonality,
  promptDirective?: string,
  label = "训练与语感指令",
): CompanionPersonality {
  const trimmed = (promptDirective || "").trim();
  if (!trimmed) return personality;

  const clone = structuredClone(personality);
  const ruleLine = `【${label}】：${trimmed}`;
  if (!clone.speechStyleRules.includes(ruleLine)) {
    clone.speechStyleRules.push(ruleLine);
  }
  if (!clone.antiOocConstraints.includes(ruleLine)) {
    clone.antiOocConstraints.push(ruleLine);
  }
  return clone;
}

/**
 * Filters scenes based on natural-language hints in the wash prompt
 * (e.g. specific `chapter_XX` mentions, `only daily` / `仅日常`, `only autonomy` / `仅自主意识`, or `pre_meeting_peer`).
 * When the prompt describes general washing/style instructions without scene exclusions, all scenes are kept.
 */
function filterScenesByWashPrompt(
  bundle: PersonaTomlBundle,
  washPrompt: string,
): PersonaTomlBundle {
  const p = washPrompt.trim();
  if (!p) return bundle;

  // Check if explicit chapter IDs are requested (e.g. "chapter_01, chapter_02")
  const explicitChapterMatches = p.match(/\b(?:chapter_\d+|autonomy_\d+|sc_\w+)\b/gi);
  if (explicitChapterMatches && explicitChapterMatches.length > 0) {
    const requestedSet = new Set(explicitChapterMatches.map((id) => id.toLowerCase()));
    const filteredScenes = bundle.washedDataset.scenes.filter((s) =>
      requestedSet.has(s.sceneId.toLowerCase()),
    );
    if (filteredScenes.length > 0) {
      return {
        ...bundle,
        washedDataset: {
          ...bundle.washedDataset,
          scenes: filteredScenes,
        },
      };
    }
  }

  // Check for track-only filter directives
  const onlyDaily = /(?:only\s+daily|仅日常|只洗日常)/i.test(p);
  const onlyAutonomy = /(?:only\s+autonomy|仅自主意识|只洗自主)/i.test(p);
  const onlyPeer = /(?:only\s+peer|pre_meeting_peer|仅同温层)/i.test(p);

  if (onlyDaily || onlyAutonomy || onlyPeer) {
    const filteredScenes = bundle.washedDataset.scenes.filter((s) => {
      const meta = bundle.sceneMetadata[s.sceneId];
      if (onlyDaily) return meta?.track === "daily";
      if (onlyAutonomy) return meta?.track === "autonomy";
      if (onlyPeer) return meta?.memoryScope === "pre_meeting_peer";
      return true;
    });
    if (filteredScenes.length > 0) {
      return {
        ...bundle,
        washedDataset: {
          ...bundle.washedDataset,
          scenes: filteredScenes,
        },
      };
    }
  }

  return bundle;
}

/**
 * Command 1: Wash Dataset (`ema wash --config <config.toml> --prompt "<what to wash>"`)
 *
 * Reads the single TOML configuration, washes `script/chapters.toml` + `script/autonomy.toml`
 * (or `[dataset].raw_input`), applies the user's washing prompt, extracts Golden Exemplars,
 * and saves the washed dataset artifact.
 */
export function washDatasetFromConfig(options: {
  configPath: string;
  prompt?: string;
  outPath?: string;
}): WashCommandResult {
  const cfg = loadUnifiedTomlConfig(options.configPath);
  const washPrompt = (options.prompt || "").trim();
  const outFile = options.outPath ? path.resolve(options.outPath) : cfg.washedDatasetPath;

  let bundle: PersonaTomlBundle;

  if (fs.existsSync(cfg.chaptersTomlPath)) {
    const parsedChaptersToml = parseToml(
      fs.readFileSync(cfg.chaptersTomlPath, "utf8"),
    ) as Record<string, any>;
    const parsedAutonomyToml = fs.existsSync(cfg.autonomyTomlPath)
      ? (parseToml(fs.readFileSync(cfg.autonomyTomlPath, "utf8")) as Record<string, any>)
      : null;

    bundle = buildPersonaTomlDataset({
      personaId: cfg.personaId,
      parsedPersonaToml: cfg.parsedToml,
      parsedChaptersToml,
      parsedAutonomyToml,
    });
  } else if (cfg.rawInputPath && fs.existsSync(cfg.rawInputPath)) {
    const initialPersonality = buildInitialPersonalityFromPersonaToml(cfg.parsedToml);
    const washedDataset = loadGalgameDataset(cfg.rawInputPath, {
      targetCharacter: cfg.targetCharacter,
      protagonistCharacter: cfg.protagonistCharacter,
    });
    const sceneMetadata: PersonaTomlBundle["sceneMetadata"] = {};
    for (const sc of washedDataset.scenes) {
      sceneMetadata[sc.sceneId] = {
        memoryScope: "companion_daily",
        track: "daily",
      };
    }
    bundle = {
      personaId: cfg.personaId,
      targetCharacter: washedDataset.targetCharacter,
      protagonistCharacter: washedDataset.protagonistCharacter,
      initialPersonality,
      rawScript: { schema_version: "1.0", scenes: [] },
      washedDataset,
      sceneMetadata,
    };
  } else {
    throw new Error(
      `No script source found for ${cfg.configFile}. Expected ${cfg.chaptersTomlPath}` +
        (cfg.rawInputPath ? ` or ${cfg.rawInputPath}` : ""),
    );
  }

  bundle = filterScenesByWashPrompt(bundle, washPrompt);
  bundle.initialPersonality = applyPromptDirectiveToPersonality(
    bundle.initialPersonality,
    washPrompt,
    "数据清洗与语感对齐指令",
  );

  const totalScenes = bundle.washedDataset.scenes.length;
  const allTurns = bundle.washedDataset.scenes.flatMap((s) => s.turns);
  const totalTurns = allTurns.length;
  const turnsWithExplicitOS = allTurns.filter((t) => Boolean(t.explicitOS)).length;
  const goldenExemplarCount = bundle.initialPersonality.goldenExemplars?.length || 0;

  const artifact: WashedBundleArtifact = {
    schemaVersion: "1.0",
    configFile: cfg.configFile,
    personaId: cfg.personaId,
    targetCharacter: bundle.targetCharacter,
    protagonistCharacter: bundle.protagonistCharacter,
    washPrompt,
    washedAt: new Date().toISOString(),
    initialPersonality: bundle.initialPersonality,
    washedDataset: bundle.washedDataset,
    sceneMetadata: bundle.sceneMetadata,
    stats: {
      totalScenes,
      totalTurns,
      turnsWithExplicitOS,
      goldenExemplarCount,
    },
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2), "utf8");

  return {
    configFile: cfg.configFile,
    washedDatasetPath: outFile,
    personaId: cfg.personaId,
    targetCharacter: bundle.targetCharacter,
    protagonistCharacter: bundle.protagonistCharacter,
    washPrompt,
    totalScenes,
    totalTurns,
    turnsWithExplicitOS,
    goldenExemplarCount,
    artifact,
  };
}

/**
 * Command 2: Train Persona (`ema train --config <config.toml> --prompt "<training focus>"`)
 *
 * Loads the single TOML configuration and washed dataset (auto-washing if not yet generated),
 * applies the user's training prompt directive, executes the supervised causal window training loop,
 * prunes pre-meeting rehearsal episodic memories per `[memory_policy]`, writes `trained-checkpoint.json`
 * and `AGENTS.md`, and syncs the companion agent state.
 */
export async function trainFromConfig(options: {
  configPath: string;
  prompt?: string;
  maxScenes?: number;
  syncAgent?: boolean;
  appDataDir?: string;
  client?: PenguinServerLLMClient;
  onSceneProgress?: (result: WindowTrainingResult, index: number, total: number) => void;
}): Promise<TrainCommandResult> {
  const cfg = loadUnifiedTomlConfig(options.configPath);
  const trainPrompt = (options.prompt || "").trim();

  // Load existing washed dataset artifact or auto-wash from TOML scripts
  let artifact: WashedBundleArtifact;
  if (fs.existsSync(cfg.washedDatasetPath)) {
    const raw = JSON.parse(fs.readFileSync(cfg.washedDatasetPath, "utf8"));
    if (raw && raw.washedDataset && raw.initialPersonality) {
      artifact = raw as WashedBundleArtifact;
    } else {
      artifact = washDatasetFromConfig({ configPath: cfg.configFile }).artifact;
    }
  } else {
    artifact = washDatasetFromConfig({ configPath: cfg.configFile }).artifact;
  }

  // Always refresh P_0_0 from current persona.toml + golden exemplars and inject training prompt
  const freshBasePersonality = buildInitialPersonalityFromPersonaToml(cfg.parsedToml);
  if (artifact.initialPersonality.goldenExemplars?.length) {
    freshBasePersonality.goldenExemplars = artifact.initialPersonality.goldenExemplars;
  }
  const seededPersonality = applyPromptDirectiveToPersonality(
    appendWashDirectiveIfPresent(freshBasePersonality, artifact.washPrompt),
    trainPrompt,
    "训练优化核心指令",
  );

  const sceneLimit = options.maxScenes ?? cfg.training.maxScenes;
  const scenesToTrain =
    sceneLimit !== undefined && sceneLimit > 0
      ? artifact.washedDataset.scenes.slice(0, sceneLimit)
      : artifact.washedDataset.scenes;

  const shouldSyncAgent = options.syncAgent ?? cfg.training.syncAgent;

  const trainer = new EmaPersonaTrainer(
    {
      targetCharacter: artifact.targetCharacter,
      protagonistCharacter: artifact.protagonistCharacter,
      companionAgentId: cfg.agentId,
      teacherAgentId: cfg.agentId,
      studentModel: {
        provider: cfg.training.provider,
        modelId: cfg.training.studentModel,
        thinkingLevel: cfg.training.thinkingLevel,
      },
      teacherModel: {
        provider: cfg.training.provider,
        modelId: cfg.training.teacherModel,
        thinkingLevel: cfg.training.thinkingLevel,
      },
      rsiScoreThreshold: cfg.training.rsiScoreThreshold,
      maxWindowAttempts: cfg.training.maxWindowAttempts,
      studentBatchSize: cfg.training.studentBatchSize,
      enableReflectionCheck: true,
      syncAgentOnDisk: false,
      useSelfRolloutHistory: cfg.training.useSelfRolloutHistory,
    },
    {
      client: options.client,
      initialPersonality: seededPersonality,
    },
  );

  const mutationCounter = { count: 0 };
  const results: WindowTrainingResult[] = [];

  for (let i = 0; i < scenesToTrain.length; i++) {
    const scene = scenesToTrain[i];
    const r = await trainer.trainSceneWindow(scene, mutationCounter);
    results.push(r);
    options.onSceneProgress?.(r, i + 1, scenesToTrain.length);
  }

  // Apply [memory_policy] post-training memory retention & pruning
  const memPolicy = cfg.parsedToml.memory_policy || {};
  const shouldPruneRehearsal =
    memPolicy.pre_meeting_companion_retention === "forget_episodic_keep_persona_weights" ||
    Object.keys(artifact.sceneMetadata || {}).some(
      (k) => artifact.sceneMetadata[k]?.memoryScope === "pre_meeting_peer",
    );

  const { retainedPeerMemoryIndex, prunedRehearsalMemoryIndex } = shouldPruneRehearsal
    ? filterPostTrainingMemoryIndex(trainer.memoryIndex, artifact.sceneMetadata || {})
    : {
        retainedPeerMemoryIndex: trainer.memoryIndex,
        prunedRehearsalMemoryIndex: [] as SceneMemoryIndexItem[],
      };

  const deployedMemoryIndex =
    retainedPeerMemoryIndex.length > 0 ? retainedPeerMemoryIndex : trainer.memoryIndex;

  const initialMeanScore =
    results.length > 0
      ? Number(
          (
            results.reduce((acc, r) => acc + r.initialMeanScore, 0) / results.length
          ).toFixed(2),
        )
      : 0;
  const finalMeanScore =
    results.length > 0
      ? Number(
          (results.reduce((acc, r) => acc + r.finalMeanScore, 0) / results.length).toFixed(
            2,
          ),
        )
      : 0;
  const totalMetrics = sumMetrics(results.map((r) => r.metrics));

  const checkpointPayload = {
    personaId: cfg.personaId,
    agentId: cfg.agentId,
    trainedAt: new Date().toISOString(),
    trainPrompt,
    washPrompt: artifact.washPrompt,
    initialMeanScore,
    finalMeanScore,
    totalScenes: results.length,
    totalMetrics,
    personality: trainer.personality,
    deployedPeerMemoryIndex: deployedMemoryIndex,
    fullTrainedMemoryIndex: trainer.memoryIndex,
    prunedRehearsalMemoryIndex,
    sceneResults: results,
  };

  fs.mkdirSync(path.dirname(cfg.checkpointPath), { recursive: true });
  fs.writeFileSync(cfg.checkpointPath, JSON.stringify(checkpointPayload, null, 2), "utf8");

  // Write AGENTS.md into the persona directory
  const agentsMdContent = renderCompanionAgentsMd(
    trainer.personality,
    deployedMemoryIndex,
    {
      protagonistName: artifact.protagonistCharacter,
    },
  );
  fs.writeFileSync(cfg.agentsMdPath, agentsMdContent, "utf8");

  let syncedAgentPath: string | undefined;
  if (shouldSyncAgent) {
    const syncRes = syncCompanionAgentState({
      personality: trainer.personality,
      memoryIndex: deployedMemoryIndex,
      agentId: cfg.agentId,
      protagonistName: artifact.protagonistCharacter,
      thinkingLevel: cfg.training.thinkingLevel,
      appDataDir: options.appDataDir,
    });
    syncedAgentPath = syncRes.agentsMdPath;
  }

  return {
    configFile: cfg.configFile,
    checkpointPath: cfg.checkpointPath,
    agentsMdPath: cfg.agentsMdPath,
    personaId: cfg.personaId,
    agentId: cfg.agentId,
    trainPrompt,
    trainedSceneCount: results.length,
    initialMeanScore,
    finalMeanScore,
    finalPersonalityVersion: trainer.personality.version,
    retainedMemoryCount: deployedMemoryIndex.length,
    prunedMemoryCount: prunedRehearsalMemoryIndex.length,
    syncedAgentPath,
    metrics: totalMetrics,
    results,
  };
}

function appendWashDirectiveIfPresent(
  personality: CompanionPersonality,
  washPrompt?: string,
): CompanionPersonality {
  return applyPromptDirectiveToPersonality(
    personality,
    washPrompt,
    "数据清洗与语感对齐指令",
  );
}

/**
 * Command 3: Manage Persona (`ema persona --config <config.toml> [show|sync|init] [--prompt "<directive>"]`)
 *
 * Manages a persona using the single TOML configuration file:
 * - `init`: Scaffolds a new single-TOML config (`persona.toml`) and starter `script/chapters.toml`
 * - `show`: Inspects the persona configuration, script chapters, and trained checkpoint status
 * - `sync`: Compiles the persona (merging `trained-checkpoint.json` if present + optional `--prompt`),
 *           writes `<personaDir>/AGENTS.md`, and syncs to the Penguin agent + `companion_portal` workbench.
 */
export function managePersonaFromConfig(options: {
  configPath: string;
  action?: "show" | "init" | "sync";
  prompt?: string;
  appDataDir?: string;
  installWorkbench?: boolean;
}): PersonaCommandResult {
  const action: "show" | "init" | "sync" =
    options.action || (options.prompt ? "sync" : "show");

  if (action === "init") {
    const absTarget = path.resolve(options.configPath);
    const configFile = absTarget.endsWith(".toml")
      ? absTarget
      : path.join(absTarget, "persona.toml");
    const personaDir = path.dirname(configFile);
    const personaId = path.basename(personaDir);
    const agentId = personaId.replace(/[^a-zA-Z0-9_]/g, "_");
    const promptDesc =
      (options.prompt || "").trim() ||
      "温柔安静、陪伴在主人身边的终身 AI 伴侣，说话自然连贯，不使用舞台括号旁白。";

    fs.mkdirSync(path.join(personaDir, "script"), { recursive: true });

    if (!fs.existsSync(configFile)) {
      const templateObj = {
        persona: {
          id: personaId,
          name: personaId,
          display_name: personaId,
          avatar: "avatar.png",
          summary: promptDesc,
          traits: {
            warm_companionship: promptDesc,
          },
        },
        speech_style: {
          tone: "第一人称口语自然互动，将动作与神态融进台词，不使用（...）舞台括号旁白",
          rhythm: "分句之间用逗号自然衔接，单条回复40～80字，句尾克制收束",
          particles: ["呢", "呀", "哦", "好不好"],
          kaomoji: ["(｡•ᴗ•｡)", "(´,,•ω•,,)♡"],
          forbidden_quirks: ["（...）第三人称舞台动作括号", "AI客服腔或百科总结腔"],
          pronouns_self: ["我"],
          pronouns_target: ["你", "主人"],
        },
        actions: ["安静陪伴在桌边，在你需要时递上温暖的关怀"],
        memory_policy: {
          pre_meeting_peer_retention: "retain_100_percent",
          pre_meeting_peer_scopes: ["pre_meeting_peer"],
          pre_meeting_companion_retention: "forget_episodic_keep_persona_weights",
          pre_meeting_companion_scopes: ["first_meeting", "companion_daily"],
        },
        invariants: {
          no_stage_brackets: "严禁使用（...）舞台括号描写动作，所有动作融进第一人称口语台词。",
          always_os_grounded: "每次回应前先以第一人称 <OS> 体察对方心境，再输出 <Action>。",
        },
        dataset: {
          chapters_toml: "script/chapters.toml",
          autonomy_toml: "script/autonomy.toml",
          washed_output: "washed-dataset.json",
          target_character: personaId,
          protagonist_character: "主人",
        },
        training: {
          agent_id: agentId,
          checkpoint_output: "trained-checkpoint.json",
          provider: "penguin-go",
          student_model: "gemini-3.8-flash",
          teacher_model: "gemini-3.8-flash",
          thinking_level: "medium",
          rsi_score_threshold: 85,
          max_window_attempts: 2,
          student_batch_size: 12,
          sync_agent: true,
        },
      };
      fs.writeFileSync(configFile, stringifyToml(templateObj) + "\n", "utf8");
    }

    const chaptersFile = path.join(personaDir, "script", "chapters.toml");
    if (!fs.existsSync(chaptersFile)) {
      const sampleChapters = {
        chapters: [
          {
            id: "chapter_01",
            order: 1,
            title: "序章 · 初遇",
            setting_time: "桌面水岸",
            memory_scope: "pre_meeting_peer",
            lines: [
              {
                type: "dialogue",
                speaker: "player",
                text: "“你好呀，今天开始请多指教。”",
              },
              {
                type: "monologue",
                speaker: "sakana",
                text: "（看到主人温柔地打招呼，我心里一下子暖洋洋的，想要好好陪伴在主人身边。）",
              },
              {
                type: "dialogue",
                speaker: "sakana",
                text: "“主人你好呀，以后不管忙到多晚，我都会安安静静守在你手边陪着你的 (｡•ᴗ•｡)”",
              },
            ],
          },
        ],
      };
      fs.writeFileSync(chaptersFile, stringifyToml(sampleChapters) + "\n", "utf8");
    }

    return managePersonaFromConfig({
      configPath: configFile,
      action: "show",
      appDataDir: options.appDataDir,
    });
  }

  const cfg = loadUnifiedTomlConfig(options.configPath);
  const p = cfg.parsedToml.persona || {};
  const traits = p.traits || {};
  const invariants = cfg.parsedToml.invariants || {};

  let chaptersCount = 0;
  let autonomyChaptersCount = 0;
  let parsedChaptersToml: Record<string, any> | null = null;
  let parsedAutonomyToml: Record<string, any> | null = null;

  if (fs.existsSync(cfg.chaptersTomlPath)) {
    parsedChaptersToml = parseToml(
      fs.readFileSync(cfg.chaptersTomlPath, "utf8"),
    ) as Record<string, any>;
    chaptersCount = Array.isArray(parsedChaptersToml.chapters)
      ? parsedChaptersToml.chapters.length
      : 0;
  }
  if (fs.existsSync(cfg.autonomyTomlPath)) {
    parsedAutonomyToml = parseToml(
      fs.readFileSync(cfg.autonomyTomlPath, "utf8"),
    ) as Record<string, any>;
    autonomyChaptersCount = Array.isArray(parsedAutonomyToml.chapters)
      ? parsedAutonomyToml.chapters.length
      : 0;
  }

  const checkpointExists = fs.existsSync(cfg.checkpointPath);
  let checkpointData: any = null;
  if (checkpointExists) {
    checkpointData = JSON.parse(fs.readFileSync(cfg.checkpointPath, "utf8"));
  }

  let syncedAgentPath: string | undefined;
  let workbenchInstalled = false;

  if (action === "sync") {
    let personality: CompanionPersonality;
    let memoryIndex: SceneMemoryIndexItem[] = [];

    if ( parsedChaptersToml ) {
      const bundle = buildPersonaTomlDataset({
        personaId: cfg.personaId,
        parsedPersonaToml: cfg.parsedToml,
        parsedChaptersToml,
        parsedAutonomyToml,
      });
      personality = bundle.initialPersonality;
    } else {
      personality = buildInitialPersonalityFromPersonaToml(cfg.parsedToml);
    }

    if (checkpointData?.personality) {
      const cp = checkpointData.personality as CompanionPersonality;
      personality.version = cp.version || personality.version;
      if (Array.isArray(cp.mutationHistory) && cp.mutationHistory.length > 0) {
        personality.mutationHistory = cp.mutationHistory;
      }
    }
    if (Array.isArray(checkpointData?.deployedPeerMemoryIndex)) {
      memoryIndex = checkpointData.deployedPeerMemoryIndex;
    } else if (Array.isArray(checkpointData?.memoryIndex)) {
      memoryIndex = checkpointData.memoryIndex;
    }

    personality = applyPromptDirectiveToPersonality(
      personality,
      options.prompt,
      "Persona 管理与微调指令",
    );

    const agentsMd = renderCompanionAgentsMd(personality, memoryIndex, {
      protagonistName: cfg.protagonistCharacter,
    });
    fs.writeFileSync(cfg.agentsMdPath, agentsMd, "utf8");

    const syncRes = syncCompanionAgentState({
      personality,
      memoryIndex,
      agentId: cfg.agentId,
      protagonistName: cfg.protagonistCharacter,
      thinkingLevel: cfg.training.thinkingLevel,
      appDataDir: options.appDataDir,
    });
    syncedAgentPath = syncRes.agentsMdPath;

    if (options.installWorkbench !== false) {
      installWebWorkbench({
        agentId: cfg.agentId,
        companionName: p.display_name || p.name || cfg.personaId,
        ownerName: cfg.protagonistCharacter,
        appDataDir: options.appDataDir,
      });
      workbenchInstalled = true;
    }
  }

  return {
    action,
    configFile: cfg.configFile,
    personaId: cfg.personaId,
    agentId: cfg.agentId,
    displayName: String(p.display_name || p.name || cfg.personaId),
    summary: String(p.summary || ""),
    traitCount: Object.keys(traits).length,
    invariantCount: Object.keys(invariants).length,
    chaptersCount,
    autonomyChaptersCount,
    checkpointExists,
    checkpointVersion: checkpointData?.personality?.version,
    agentsMdPath: cfg.agentsMdPath,
    syncedAgentPath,
    workbenchInstalled,
  };
}
