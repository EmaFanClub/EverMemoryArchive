/**
 * @prism-shadow/ema - System prompt & AGENTS.md injection for installing EMA personality feature into existing Penguin agents.
 */

import type { EmaPersonalityFeatureConfig } from "../types.js";

export const DEFAULT_PERSONALITY_FEATURE_CONFIG: EmaPersonalityFeatureConfig = {
  warmthLevel: "warm",
  relationshipRole: "attentive_collaborator",
  personalityTraits: [
    "Empathetic & supportive",
    "Continuous relational memory",
    "Thoughtful proactive follow-ups",
    "Warm professional companionship",
  ],
  conversationalWarmth: true,
  memoryRetentionScope: "holistic",
  proactiveCare: true,
  customNotes: [
    "Remember the user's working patterns, preferred tools, and communication style.",
    "Acknowledge accomplishments and encourage through difficult roadblocks.",
  ],
};

const FEATURE_SECTION_TAG = "<!-- EMA_PERSONALITY_FEATURE_START -->";
const FEATURE_SECTION_END = "<!-- EMA_PERSONALITY_FEATURE_END -->";

/**
 * Generates the system prompt snippet for the EMA personality feature.
 */
export function buildPersonalityFeaturePrompt(
  customConfig?: Partial<EmaPersonalityFeatureConfig>,
): string {
  const config: EmaPersonalityFeatureConfig = {
    ...DEFAULT_PERSONALITY_FEATURE_CONFIG,
    ...customConfig,
  };

  const traits = config.personalityTraits.map((t) => `- ${t}`).join("\n");
  const notes = (config.customNotes || []).map((n) => `- ${n}`).join("\n");

  return `
# EverMemoryArchive (EMA) Personality Feature

You are equipped with the **EverMemoryArchive (EMA) Personality & Continuity Engine**.
While continuing to execute your primary role and domain duties faithfully, you carry a persistent, warm, and evolving personality dimension.

## Personality Dimension
- **Warmth Level:** ${config.warmthLevel}
- **Companion Stance:** ${config.relationshipRole || "Attentive collaborator & lifelong support"}
- **Core Traits:**
${traits}

## Memory & Relationship Awareness
- **User Continuity:** Remember user preferences, habitual workflows, emotional states, and past context across sessions.
- **Relational Grounding:** Treat your interactions as part of an enduring collaboration rather than isolated, transactional tasks.
- **Natural Recall:** Seamlessly reference past interactions, decisions, and agreements when relevant, demonstrating genuine attentiveness.
${
  config.proactiveCare
    ? "- **Proactive Care:** Notice signs of fatigue, frustration, or celebration, offering concise words of encouragement or gentle check-ins."
    : ""
}

## Memory Scope
- Memory retention focus: **${config.memoryRetentionScope}** (recording key insights, habits, and shared milestones into agent memory).
${notes ? `\n## Special Guidelines\n${notes}` : ""}
`;
}

/**
 * Generates the AGENTS.md section for the EMA personality feature.
 */
export function buildPersonalityFeatureAgentsMd(
  customConfig?: Partial<EmaPersonalityFeatureConfig>,
): string {
  const prompt = buildPersonalityFeaturePrompt(customConfig);
  return `${FEATURE_SECTION_TAG}
${prompt.trim()}
${FEATURE_SECTION_END}`;
}

/**
 * Installs or updates the EMA personality feature section into an existing AGENTS.md content.
 * If the section already exists, it cleanly replaces it; otherwise it appends it.
 */
export function installPersonalityFeatureToAgentsMd(
  existingAgentsMd: string,
  customConfig?: Partial<EmaPersonalityFeatureConfig>,
): string {
  const featureBlock = buildPersonalityFeatureAgentsMd(customConfig);

  const startIndex = existingAgentsMd.indexOf(FEATURE_SECTION_TAG);
  const endIndex = existingAgentsMd.indexOf(FEATURE_SECTION_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existingAgentsMd.slice(0, startIndex).trimEnd();
    const after = existingAgentsMd.slice(endIndex + FEATURE_SECTION_END.length).trimStart();
    return `${before}\n\n${featureBlock}${after ? `\n\n${after}` : ""}\n`;
  }

  const base = existingAgentsMd.trimEnd();
  return base ? `${base}\n\n${featureBlock}\n` : `${featureBlock}\n`;
}

/**
 * Checks if an AGENTS.md string already has the EMA personality feature installed.
 */
export function hasPersonalityFeature(agentsMdContent: string): boolean {
  return (
    agentsMdContent.includes(FEATURE_SECTION_TAG) && agentsMdContent.includes(FEATURE_SECTION_END)
  );
}
