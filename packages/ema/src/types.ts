/**
 * @prism-shadow/ema - TypeScript type definitions
 * Core interfaces for EMA lifelong AI companions and personality features.
 */

export type EmaWarmthLevel =
  "gentle" | "warm" | "deeply_attached" | "calm_professional" | "playful";

export type EmaRelationshipRole =
  | "lifelong_companion"
  | "study_partner"
  | "creative_copilot"
  | "mindful_mentor"
  | "sympathetic_friend"
  | "curious_explorer"
  | "custom";

export type EmaRelationalStage =
  "acquaintance" | "emerging_bond" | "trusted_companion" | "lifelong_partner";

export type EmaCircadianPhase = "wake" | "active" | "wind_down" | "sleep_consolidating";

/**
 * Structured, persistent internal state vector for EMA companion agents.
 * Conforms to EMA Action Subsystem Specification (node-mw32u3x5-snhq).
 */
export interface EmaAgentState {
  affective: {
    /** Emotional valence: -1.0 (distressed/sad) to +1.0 (joyful/content) */
    valence: number;
    /** Physiological arousal: 0.0 (dormant/calm) to 1.0 (alert/excited) */
    arousal: number;
    /** Current energy reserve: 0.0 (exhausted/drained) to 1.0 (vibrant/rested) */
    energy: number;
  };
  relational: {
    /** Relational progression tier */
    stage: EmaRelationalStage;
    /** Continuous intimacy level (0.0 to 1.0) */
    intimacy: number;
    /** Expressive warmth style configured by personality */
    warmthLevel: EmaWarmthLevel;
    /** Timestamp of last active interaction (ISO string) */
    lastInteractionAt: string;
    /** Active proactive cooldown expiration timestamp (ISO string) */
    proactiveCooldownUntil?: string;
  };
  circadian: {
    /** Current biological/operational phase */
    phase: EmaCircadianPhase;
    /** Hour of circadian day (0-23) */
    currentHour: number;
    /** Whether background memory consolidation is underway */
    isConsolidating: boolean;
  };
  cognitive: {
    /** Current focus or ongoing topic */
    focusTopic?: string;
    /** Cognitive load (0.0 idle to 1.0 peak concentration) */
    cognitiveLoad: number;
    /** Unanswered curiosities or pending reflective items */
    pendingReflections: string[];
  };
}

export type EmaMilestoneCategory =
  "birthday" | "anniversary" | "project_launch" | "shared_memory" | "custom";

export interface EmaMilestone {
  /** Unique milestone identifier */
  id: string;
  /** Title / subject of the milestone */
  title: string;
  /** Calendar date: "YYYY-MM-DD" or "MM-DD" */
  date: string;
  /** Milestone category */
  category: EmaMilestoneCategory;
  /** Optional detailed description or memory context */
  description?: string;
  /** Target world part ID for notification (default: "milestones") */
  targetPartId?: string;
  /** Recurrence rule: "yearly" (default for birthdays/anniversaries), "monthly", or "once" */
  recurring?: "yearly" | "monthly" | "once";
  /** Date string of last dispatched alert (e.g. "2026-11-08") */
  lastNotifiedDate?: string;
  /** Optional custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Creates a default EmaAgentState vector with sensible companion baselines.
 */
export function createDefaultAgentState(
  overrides?: Partial<EmaAgentState> & {
    affective?: Partial<EmaAgentState["affective"]>;
    relational?: Partial<EmaAgentState["relational"]>;
    circadian?: Partial<EmaAgentState["circadian"]>;
    cognitive?: Partial<EmaAgentState["cognitive"]>;
  },
  nowDate?: Date,
): EmaAgentState {
  const now = nowDate ?? new Date();
  const currentHour = now.getHours();
  return {
    affective: {
      valence: 0.5,
      arousal: 0.3,
      energy: 0.8,
      ...overrides?.affective,
    },
    relational: {
      stage: "acquaintance",
      intimacy: 0.1,
      warmthLevel: "warm",
      lastInteractionAt: now.toISOString(),
      ...overrides?.relational,
    },
    circadian: {
      phase: currentHour >= 23 || currentHour < 7 ? "sleep_consolidating" : "active",
      currentHour,
      isConsolidating: currentHour >= 23 || currentHour < 7,
      ...overrides?.circadian,
    },
    cognitive: {
      cognitiveLoad: 0.1,
      pendingReflections: [],
      ...overrides?.cognitive,
    },
  };
}

export interface EmaMemoryTierConfig {
  /** Immediate turn-by-turn context preservation and topic tracking */
  workingBuffer: boolean;
  /** Activity-level conversational chunking and reflection */
  activityRollup: boolean;
  /** Comprehensive daily journal synthesis in character voice */
  dayJournal: boolean;
  /** Monthly relational and milestone digests */
  monthDigest: boolean;
  /** LanceDB-backed semantic long-term memory (Past Events, Person Profiles, World Knowledge, Procedural Knowledge) */
  longTermKnowledge: boolean;
}

export interface EmaCircadianConfig {
  /** Whether circadian wake/sleep cycle is active */
  enabled: boolean;
  /** Hour of day to wake up (0-23, default: 7) */
  wakeHour: number;
  /** Hour of day to rest/consolidate (0-23, default: 23) */
  sleepHour: number;
  /** Perform autonomous memory consolidation and journaling during rest phase */
  consolidationOnSleep: boolean;
}

export interface EmaAgentConfig {
  /** Unique Agent ID within PenguinHarness (letters, digits, underscores) */
  id: string;
  /** Display name of the companion (e.g. "Ema", "艾玛") */
  name: string;
  /** Role title (e.g. "Lifelong AI Companion", "终身伴侣") */
  title: string;
  /** Narrative backstory, core identity, and character essence */
  bio: string;
  /** Archetypal relationship role */
  relationshipRole: EmaRelationshipRole | string;
  /** Warmth and intimacy tone */
  warmthLevel: EmaWarmthLevel;
  /** Primary communication language ("zh-CN", "en", "ja", "multilingual") */
  language: string;
  /** Natural speech habits, quirks, and expressive tone */
  speechStyle?: string;
  /** Hierarchical memory tier settings */
  memoryTiers?: Partial<EmaMemoryTierConfig>;
  /** Circadian rhythm and sleep-wake cycle settings */
  circadian?: Partial<EmaCircadianConfig>;
  /** Custom companion guidelines */
  customGuidelines?: string[];
  /** Privacy and relational boundaries */
  boundaries?: string[];
}

export interface EmaPersonalityFeatureConfig {
  /** ID of the target Penguin agent to extend */
  targetAgentId?: string;
  /** Warmth and empathy level */
  warmthLevel: EmaWarmthLevel;
  /** Perceived relationship role (e.g. "trusted peer", "empathetic co-worker") */
  relationshipRole?: string;
  /** Distinct personality traits to overlay */
  personalityTraits: string[];
  /** Enable proactive conversational warmth and caring inquiries */
  conversationalWarmth: boolean;
  /** Memory retention focus */
  memoryRetentionScope: "holistic" | "tasks_and_preferences" | "professional_only";
  /** Proactive care and milestone reminders */
  proactiveCare: boolean;
  /** Custom personality instructions */
  customNotes?: string[];
}

export interface GeneratedAgentPrompt {
  /** Full system prompt configuration */
  systemPrompt: string;
  /** AGENTS.md content to be placed into agent_state/AGENTS.md */
  agentsMd: string;
  /** Metadata for Penguin agent configuration (system_config.yaml) */
  metadata: {
    id: string;
    name: string;
    title: string;
    description: string;
    version: number;
    tags: string[];
  };
}

export interface EmaPresetTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  config: Partial<EmaAgentConfig>;
}

export interface PersonalityPresetTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  config: Partial<EmaPersonalityFeatureConfig>;
}
