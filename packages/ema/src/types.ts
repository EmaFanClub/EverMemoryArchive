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
