import { describe, it, expect } from "vitest";
import {
  buildPersonalityFeaturePrompt,
  buildPersonalityFeatureAgentsMd,
  installPersonalityFeatureToAgentsMd,
  hasPersonalityFeature,
} from "../src/prompts/personality-feature.js";
import { PERSONALITY_FEATURE_PRESETS } from "../src/prompts/presets.js";

describe("EMA Personality Feature Injection", () => {
  it("generates personality feature prompt snippet with traits", () => {
    const prompt = buildPersonalityFeaturePrompt({
      warmthLevel: "playful",
      relationshipRole: "spirited_study_buddy",
      personalityTraits: ["Playful banter", "High energy"],
    });

    expect(prompt).toContain("EverMemoryArchive (EMA) Personality Feature");
    expect(prompt).toContain("**Warmth Level:** playful");
    expect(prompt).toContain("Playful banter");
  });

  it("appends feature block to existing AGENTS.md cleanly", () => {
    const existing = `# My Developer Agent\n\nYou write clean Python code.`;
    const installed = installPersonalityFeatureToAgentsMd(existing, {
      warmthLevel: "gentle",
    });

    expect(installed).toContain("# My Developer Agent");
    expect(installed).toContain("You write clean Python code.");
    expect(installed).toContain("<!-- EMA_PERSONALITY_FEATURE_START -->");
    expect(installed).toContain("<!-- EMA_PERSONALITY_FEATURE_END -->");
    expect(hasPersonalityFeature(installed)).toBe(true);
  });

  it("replaces existing feature block if updated", () => {
    const existing = `# My Agent\n\nBase rules.\n\n<!-- EMA_PERSONALITY_FEATURE_START -->\nOld Feature\n<!-- EMA_PERSONALITY_FEATURE_END -->\n\nTrailing rules.`;
    const updated = installPersonalityFeatureToAgentsMd(existing, {
      warmthLevel: "deeply_attached",
      personalityTraits: ["New trait"],
    });

    expect(updated).toContain("# My Agent");
    expect(updated).toContain("Trailing rules.");
    expect(updated).not.toContain("Old Feature");
    expect(updated).toContain("New trait");
    expect(updated.match(/<!-- EMA_PERSONALITY_FEATURE_START -->/g)?.length).toBe(1);
  });

  it("all personality presets generate valid feature prompts", () => {
    for (const preset of PERSONALITY_FEATURE_PRESETS) {
      const prompt = buildPersonalityFeaturePrompt(preset.config);
      expect(prompt).toContain("EverMemoryArchive (EMA) Personality Feature");
      expect(prompt).toContain(preset.config.warmthLevel!);
    }
  });
});
