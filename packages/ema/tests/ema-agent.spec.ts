import { describe, it, expect } from "vitest";
import {
  buildEmaSystemPrompt,
  buildEmaAgentsMd,
  generateEmaAgent,
  DEFAULT_EMA_CONFIG,
} from "../src/prompts/ema-agent.js";
import { EMA_AGENT_PRESETS } from "../src/prompts/presets.js";

describe("EMA Agent System Prompt Generation", () => {
  it("generates default system prompt with core mission and memory architecture", () => {
    const prompt = buildEmaSystemPrompt();
    expect(prompt).toContain(
      "We build lifelong AI companions that grow, remember, and evolve with you.",
    );
    expect(prompt).toContain("Working Buffer Memory");
    expect(prompt).toContain("Episodic Memory Tiers");
    expect(prompt).toContain("Semantic Long-Term Knowledge Categories");
    expect(prompt).toContain("过往事件 (Past Events)");
    expect(prompt).toContain("人物画像 (Person Profiles)");
    expect(prompt).toContain("百科知识 (World Knowledge)");
    expect(prompt).toContain("经验方法 (Procedural Knowledge)");
    expect(prompt).toContain("Ema");
  });

  it("customizes agent name, role, warmth, and guidelines", () => {
    const prompt = buildEmaSystemPrompt({
      id: "serena",
      name: "Serena",
      title: "Philosophy & Study Companion",
      warmthLevel: "gentle",
      relationshipRole: "mindful_mentor",
      customGuidelines: ["Always quote Stoic philosophers when appropriate."],
    });

    expect(prompt).toContain("Serena");
    expect(prompt).toContain("Philosophy & Study Companion");
    expect(prompt).toContain("A wise, calm, reflective guide offering gentle perspectives");
    expect(prompt).toContain("Always quote Stoic philosophers when appropriate.");
  });

  it("builds AGENTS.md document correctly", () => {
    const agentsMd = buildEmaAgentsMd({
      name: "Lumi",
      title: "Curious Explorer",
    });

    expect(agentsMd).toContain("# Lumi — Curious Explorer");
    expect(agentsMd).toContain("EverMemoryArchive (EMA)");
    expect(agentsMd).toContain("Memory & Relationship Rules");
  });

  it("generates complete package with metadata", () => {
    const result = generateEmaAgent({
      id: "aria",
      name: "Aria",
    });

    expect(result.metadata.id).toBe("aria");
    expect(result.metadata.name).toBe("Aria");
    expect(result.systemPrompt).toContain("Aria");
    expect(result.agentsMd).toContain("Aria");
  });

  it("all agent presets generate valid prompts", () => {
    for (const preset of EMA_AGENT_PRESETS) {
      const prompt = buildEmaSystemPrompt(preset.config);
      expect(prompt).toContain(preset.config.name!);
      expect(prompt).toContain(preset.config.title!);
    }
  });
});
