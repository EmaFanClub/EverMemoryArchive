import { describe, it, expect } from "vitest";
import {
  validateEmaAgentConfig,
  generatePenguinSystemConfigYaml,
  getAgentPreset,
  getPersonalityPreset,
} from "../src/builder.js";

describe("EMA Builder Utilities", () => {
  it("validates valid agent ID and names", () => {
    const valid = validateEmaAgentConfig({
      id: "my_ema_agent_1",
      name: "Ema",
      title: "Companion",
    });
    expect(valid.valid).toBe(true);
    expect(valid.errors.length).toBe(0);
  });

  it("rejects invalid agent ID with hyphens or invalid characters", () => {
    const invalid = validateEmaAgentConfig({
      id: "my-invalid-agent",
      name: "Ema",
      title: "Companion",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toContain(
      "Agent ID must contain only letters, numbers, and underscores",
    );
  });

  it("generates valid Penguin system_config.yaml", () => {
    const yaml = generatePenguinSystemConfigYaml({
      name: "Kaelen",
      bio: "Mindful guide",
    });

    expect(yaml).toContain('name: "Kaelen"');
    expect(yaml).toContain('description: "Mindful guide"');
    expect(yaml).toContain("version: 1");
    expect(yaml).toContain('thinking_level: "medium"');
  });

  it("retrieves presets by ID", () => {
    expect(getAgentPreset("warm_companion")).toBeDefined();
    expect(getAgentPreset("non_existent")).toBeUndefined();
    expect(getPersonalityPreset("empathetic_collaborator")).toBeDefined();
  });
});
