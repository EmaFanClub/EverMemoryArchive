/**
 * @prism-shadow/ema - Training Prototype Types (RFC-0003 / RFC-0004 / RFC-0005)
 *
 * Defines generic, character-agnostic data structures for:
 * - Narrative script washing & Turn Bundle construction (D = {q_1, ..., q_T})
 * - Latent-mediated forward trajectory: Input_t -> OS_t -> Action_t
 * - Single-level In-Context MemoryIndex_{0,x} = compress({MemoryItem_n})
 * - Structured CompanionPersonality P_{u,v} & Teacher RSI mutation loop
 * - Base model & thinking level ablation metrics
 */

export type ScriptLineType = "narration" | "dialogue" | "monologue";

export interface RawScriptLine {
  index: number;
  global_index: number;
  type: ScriptLineType;
  speaker: string | null;
  text: string;
  raw: string;
}

export interface RawScriptScene {
  scene_id: string;
  title: string;
  setting_time: string | null;
  setting: string | null;
  order: number;
  line_count: number;
  characters: string[];
  lines: RawScriptLine[];
}

export interface RawGalgameScript {
  schema_version: string;
  metadata?: Record<string, unknown>;
  scenes: RawScriptScene[];
}

/**
 * A single training question / turn bundle q_t = <Input_t, GT_Action_t>.
 */
export interface TurnBundle {
  /** Globally unique turn ID, e.g. "scene_01#turn-03" */
  id: string;
  /** Scene identifier */
  sceneId: string;
  /** 1-based turn index within the scene */
  turnIndexInScene: number;
  /** 1-based global turn index across the filtered dataset D */
  globalTurnIndex: number;
  /** Non-target lines preceding this turn (narration + other speakers' lines) */
  inputLines: RawScriptLine[];
  /** Formatted Input_t string shown to the Student & Teacher */
  inputText: string;
  /** Consecutive target-character lines coalesced into this turn */
  gtActionLines: RawScriptLine[];
  /** Formatted Ground Truth Action_t^* string */
  gtActionText: string;
  /** Explicit monologue lines from the raw script if present in this turn */
  explicitOS: string | null;
}

/**
 * A scene window containing sequential TurnBundles for episodic training & compaction.
 */
export interface SceneWindow {
  sceneId: string;
  order: number;
  chapter: string;
  title: string;
  setting: string;
  isHScene: boolean;
  characters: string[];
  rawLineCount: number;
  turns: TurnBundle[];
  /** Lines appearing after the target character's final turn in the scene */
  trailingLines: RawScriptLine[];
  trailingText: string;
}

export interface DatasetWashStats {
  totalRawScenes: number;
  storyScenesWithTarget: number;
  nonHScenesWithTarget: number;
  hScenesWithTarget: number;
  selectedSceneCount: number;
  totalRawTargetLines: number;
  totalTurnBundles: number;
  explicitTargetMonologues: number;
  speakerAliasCounts: Record<string, number>;
}

export interface WashedDataset {
  targetCharacter: string;
  protagonistCharacter: string;
  stats: DatasetWashStats;
  scenes: SceneWindow[];
}

/**
 * Structured Companion Personality P_{u,v} (RFC-0004 / RFC-0005).
 */
export interface CompanionPersonality {
  /** Version label, e.g. "P_0_0", "P_0_1", "P_1_0" */
  version: string;
  /** Target character display name */
  name: string;
  /** Core identity, background, worldview, and bond with the counterpart */
  coreIdentity: string;
  /** Archetype & emotional dynamics */
  emotionalDynamics: string[];
  /** Concrete speech style rules, sentence length constraints, and catchphrases */
  speechStyleRules: string[];
  /** Latent <OS> inner monologue cognitive patterns that bridge Input -> Action */
  cognitiveOSPatterns: string[];
  /** Signature physical actions & behavioral habits */
  behavioralHabits: string[];
  /** Anti-OOC negative constraints accumulated via Teacher RSI error diagnostics */
  antiOocConstraints: string[];
  /** Evolution changelog across training windows */
  mutationHistory: Array<{
    fromVersion: string;
    toVersion: string;
    sceneId: string;
    reason: string;
    scoreBefore: number;
    scoreAfter?: number;
  }>;
}

/**
 * External configuration bundle for loading character-specific aliases and initial P_{0,0}
 * from a JSON file outside the repository.
 */
export interface ExternalPersonaSeedBundle {
  targetCharacter: string;
  protagonistCharacter?: string;
  speakerAliases?: string[];
  sceneSpeakerOverrides?: Record<string, string[]>;
  personality: CompanionPersonality;
}

/**
 * A committed episodic turn memory item: MemoryItem_t = <Input_t, OS_t, GT_Action_t>.
 */
export interface MemoryItem {
  turnId: string;
  sceneId: string;
  turnIndexInScene: number;
  inputText: string;
  /** Student's predicted latent OS_t */
  predictedOS: string;
  /** Teacher-verified or imputed latent OS_t^* stored in memory */
  committedOS: string;
  /** Student's predicted Action_t (used for scoring, discarded from trajectory state) */
  predictedAction: string;
  /** Teacher-forced Ground Truth Action_t^* committed to trajectory state */
  gtActionText: string;
  /** Whether predictedOS is logically & psychologically consistent with gtActionText */
  osConsistent: boolean;
  /** Teacher score (0-100) for OS consistency & depth */
  osScore: number;
  /** Teacher score (0-100) for Action similarity (tone, cadence, subtext, action habits) */
  actionScore: number;
  /** Weighted combined turn score (0.4 * osScore + 0.6 * actionScore) */
  combinedScore: number;
  /** Brief diagnostic from Teacher explaining gaps or praising accuracy */
  diagnostic: string;
}

/**
 * Single-level In-Context MemoryIndex item produced at a scene boundary:
 * MemoryIndex_{0,x} = compress({MemoryItem_n}).
 */
export interface SceneMemoryIndexItem {
  sceneId: string;
  order: number;
  chapter: string;
  title: string;
  setting: string;
  /** Concise first-person episodic summary from the target character's perspective */
  summary: string;
  /** Target character's latent inner feelings (<OS> trajectory) during this scene */
  innerOSArc: string;
  /** Key relational facts, lore, or promises to remember in future scenes */
  keyFacts: string[];
  /** Optional reflection score (0-100) measuring how well the agent reconstructs scene details from this index item */
  reflectionScore?: number;
}

/**
 * Trainable compression prompt configuration C_{u,v}.
 */
export interface CompressionPromptConfig {
  version: string;
  instructions: string;
  maxSummaryChars: number;
  maxKeyFacts: number;
}

export interface LlmCallMetrics {
  latencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  responseTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface WindowTrainingResult {
  sceneId: string;
  title: string;
  turnCount: number;
  personalityVersionUsed: string;
  personalityMutatedTo?: string;
  attempts: number;
  initialMeanScore: number;
  finalMeanScore: number;
  osConsistencyRate: number;
  meanOsScore: number;
  meanActionScore: number;
  reflectionScore?: number;
  memoryIndexItem: SceneMemoryIndexItem;
  items: MemoryItem[];
  metrics: LlmCallMetrics;
}

export interface ModelAblationCandidate {
  id: string;
  provider: string;
  modelId: string;
  thinkingLevel: "low" | "medium" | "high";
}

export interface ModelAblationResult {
  candidate: ModelAblationCandidate;
  sceneCount: number;
  turnCount: number;
  formatSuccessRate: number;
  osConsistencyRate: number;
  meanOsScore: number;
  meanActionScore: number;
  meanCombinedScore: number;
  totalLatencyMs: number;
  msPerTurn: number;
  metrics: LlmCallMetrics;
  sampleOutputs: Array<{
    turnId: string;
    inputText: string;
    predictedOS: string;
    predictedAction: string;
    gtActionText: string;
    combinedScore: number;
  }>;
  error?: string;
}
