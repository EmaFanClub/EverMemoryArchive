/**
 * @prism-shadow/ema - Core Cognitive Architecture Types (RFC-0003 ~ RFC-0007)
 *
 * Shared, character-agnostic state representations across the three EMA lifecycle engines:
 * - Pre-birth Supervised Script Reverse-Engineering (`training/`, RFC-0003 ~ RFC-0005)
 * - Online / Session-Boundary Memory Compaction & Multi-Level Indexing (`compaction/`, RFC-0006)
 * - Parallel Background & Circadian Dreaming Consolidation (`dreaming/`, RFC-0007)
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
 * A single training or replay turn bundle q_t = <Input_t, GT_Action_t>.
 */
export interface TurnBundle {
  /** Globally unique turn ID, e.g. "scene_01#turn-03" */
  id: string;
  /** Scene identifier */
  sceneId: string;
  /** 1-based turn index within the scene */
  turnIndexInScene: number;
  /** 1-based global turn index across the dataset D */
  globalTurnIndex: number;
  /** Non-target lines preceding this turn (narration + other speakers' lines) */
  inputLines: RawScriptLine[];
  /** Formatted Input_t string shown to the Student & Teacher */
  inputText: string;
  /** Consecutive target-character lines coalesced into this turn */
  gtActionLines: RawScriptLine[];
  /** Formatted Ground Truth Action_t^* (or synthesized dream target a_t^dream) */
  gtActionText: string;
  /** Explicit monologue lines if present in this turn */
  explicitOS: string | null;
}

/**
 * A scene window containing sequential TurnBundles for episodic training, replay, & compaction.
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
 * Structured Companion Personality P_{u,v} (RFC-0004 ~ RFC-0007).
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
  /** Anti-OOC negative constraints accumulated via Teacher RSI / Dreaming diagnostics */
  antiOocConstraints: string[];
  /** Evolution changelog across training and dreaming windows */
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
 * A committed episodic turn memory item: MemoryItem_t = <Input_t, OS_t, Action_t>.
 */
export interface MemoryItem {
  turnId: string;
  sceneId: string;
  turnIndexInScene: number;
  inputText: string;
  /** Student's predicted or live latent OS_t */
  predictedOS: string;
  /** Teacher-verified or hindsight-calibrated latent OS_t^* stored in memory */
  committedOS: string;
  /** Student's predicted or live Action_t */
  predictedAction: string;
  /** Teacher-forced GT Action_t^* (or committed live Action_t / a_t^dream) */
  gtActionText: string;
  /** Whether predictedOS is logically & psychologically consistent with target Action */
  osConsistent: boolean;
  /** Teacher score (0-100) for OS consistency & depth */
  osScore: number;
  /** Teacher score (0-100) for Action quality (tone, cadence, subtext, action habits) */
  actionScore: number;
  /** Weighted combined turn score (0.4 * osScore + 0.6 * actionScore) */
  combinedScore: number;
  /** Brief diagnostic from Teacher explaining gaps or praising accuracy */
  diagnostic: string;
}

/**
 * Level-0 (Scene-level) In-Context MemoryIndex item produced at an episodic boundary:
 * MemoryIndex_{0,x} = compress_0({MemoryItem_n}).
 */
export interface SceneMemoryIndexItem {
  sceneId: string;
  order: number;
  chapter: string;
  title: string;
  setting: string;
  /** Concise first-person episodic summary from the companion's perspective */
  summary: string;
  /** Companion's latent inner feelings (<OS> trajectory) during this scene */
  innerOSArc: string;
  /** Key relational facts, lore, or promises to remember in future scenes */
  keyFacts: string[];
  /** Optional reflection score (0-100) measuring reconstructibility */
  reflectionScore?: number;
  /** Optional logical pointer to the persistent cold archive record (RFC-0006) */
  archiveRef?: string;
  /** Optional parent Level-1 epoch ID once rolled up into MemoryIndex_{1,y} (RFC-0006) */
  rolledUpIntoEpochId?: string;
}

/**
 * Level-1 (Chapter / Epoch-level) In-Context MemoryIndex item produced by rolling up
 * contiguous Level-0 SceneMemoryIndexItems (RFC-0006):
 * MemoryIndex_{1,y} = compress_1({MemoryIndex_{0,x}}).
 */
export interface EpochMemoryIndexItem {
  epochId: string;
  order: number;
  title: string;
  timeSpan: string;
  /** IDs of the Level-0 SceneMemoryIndexItems folded into this epoch digest */
  sourceSceneIds: string[];
  /** First-person macro-summary across the constituent scenes */
  summary: string;
  /** Relational and emotional evolution arc across the epoch */
  emotionalEvolutionArc: string;
  /** Deduplicated, long-term anchor facts retained from the constituent scenes */
  consolidatedKeyFacts: string[];
  /** Optional reconstructibility score (0-100) */
  reflectionScore?: number;
}

/**
 * Trainable compression prompt configuration C_{u,v} (RFC-0004 / RFC-0006).
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

export type AblationCandidateConfig = ModelAblationCandidate;
export type AblationResultEntry = ModelAblationResult;

/**
 * A live conversation turn extracted from an Actor's Route Session trace or transcript (RFC-0006 / RFC-0007).
 */
export interface LiveConversationTurn {
  /** 1-based monotonic turn index in the session trace */
  turnIndex: number;
  /** Stable turn identifier, e.g. "session-619e98db#turn-004" */
  turnId: string;
  /** ISO-8601 timestamp when the user message arrived */
  timestamp: string;
  /** Parsed sender display name or user ID */
  sender: string;
  /** Parsed channel or world context (e.g. "qq:group:2000000001", "direct") */
  channel: string;
  /** User input text */
  inputText: string;
  /** Companion's latent inner monologue extracted from the emitted <OS>...</OS> tag */
  latentOS: string;
  /** Companion's external reply / action text extracted from the emitted <Action>...</Action> tag */
  actionText: string;
}

/**
 * An episodic window sliced from a live conversation stream by the Boundary Detector (RFC-0006).
 */
export interface EpisodicWindowSlice {
  sceneId: string;
  order: number;
  chapter: string;
  title: string;
  setting: string;
  boundaryReason:
    | "token_watermark"
    | "turn_watermark"
    | "idle_gap"
    | "channel_shift"
    | "session_flush";
  startTurnIndex: number;
  endTurnIndex: number;
  turns: LiveConversationTurn[];
}

/**
 * Result of running RFC-0006 `compact` over a stream of conversation turns or existing L0 indices.
 */
export interface CompactionRunResult {
  newL0Items: SceneMemoryIndexItem[];
  newL1Items: EpochMemoryIndexItem[];
  retriedWithReflectionCount: number;
  compressionMutatedTo?: CompressionPromptConfig;
  compactedTurnCount: number;
  previousCursor: number;
  newCursor: number;
  metrics: LlmCallMetrics;
}

/**
 * Hindsight evaluation of a live turn during RFC-0007 `dreaming`, using subsequent user reactions
 * Input_{t+1..t+k} and anchor personality rules instead of script Ground Truth.
 */
export interface HindsightTurnEvaluation {
  turnId: string;
  sceneId: string;
  turnIndexInScene: number;
  inputText: string;
  observedOS: string;
  observedAction: string;
  subsequentUserReaction: string;
  osScore: number;
  actionScore: number;
  combinedScore: number;
  driftDetected: boolean;
  diagnostic: string;
  /** Counterfactual ideal inner monologue OS_t^* synthesized in hindsight */
  synthesizedDreamOS: string;
  /** Counterfactual ideal reply a_t^dream synthesized in hindsight */
  synthesizedDreamAction: string;
}

/**
 * Result of running an RFC-0007 `dreaming` consolidation cycle (foreground or parallel background).
 */
export interface DreamCycleResult {
  agentId: string;
  routeSessionId?: string;
  compactionResult?: CompactionRunResult;
  evaluatedSceneCount: number;
  evaluatedTurnCount: number;
  meanDaytimeScore: number;
  driftFailureCount: number;
  consolidatedFactCount: number;
  personalityVersionBefore: string;
  personalityVersionAfter: string;
  personalityMutated: boolean;
  mutationReason?: string;
  replayScoreBefore?: number;
  replayScoreAfter?: number;
  anchorBenchmarkScore?: number;
  gatePassed: boolean;
  syncedAgentsMdPath?: string;
  metrics: LlmCallMetrics;
}

/**
 * Persistent cognitive state for an EMA companion agent (RFC-0004 ~ RFC-0007).
 */
export interface CompanionCognitiveState {
  schemaVersion: "1.0.0";
  agentId: string;
  protagonistName: string;
  personality: CompanionPersonality;
  anchorPersonality: CompanionPersonality;
  compressionPrompt: CompressionPromptConfig;
  /** Level-0 scene-level memory indices */
  memoryIndex: SceneMemoryIndexItem[];
  /** Level-1 epoch/chapter-level rolled-up memory indices */
  l1MemoryIndex: EpochMemoryIndexItem[];
  /** Monotonic turn cursor per route session ID so parallel background runs are idempotent */
  sessionTurnCursors: Record<string, number>;
  /** Scene IDs that have already undergone dreaming hindsight consolidation */
  dreamedSceneIds: string[];
  /** Optional anchor benchmark windows used as regression gate during dreaming */
  anchorBenchmarkScenes?: SceneWindow[];
  updatedAt: string;
}
