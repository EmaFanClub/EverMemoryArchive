import { describe, expect, test } from "vitest";

import { PromptCaching, ThinkingLevel } from "../base";
import { resolveLLMModelConfig, resolveLLMModelDefinition } from "../models";

describe("AgentHub model registry", () => {
  test("uses AgentHub client routes for updated model presets", () => {
    expect(resolveLLMModelDefinition("gemini-3.5-flash").clientType).toBe(
      "gemini-3",
    );
    expect(resolveLLMModelDefinition("deepseek-v4-pro").clientType).toBe(
      "deepseek-v4",
    );
    expect(resolveLLMModelDefinition("glm-5.1").clientType).toBe("glm-5.1");
    expect(resolveLLMModelDefinition("kimi-k2.6").clientType).toBe("kimi-k2.6");
    expect(resolveLLMModelDefinition("Qwen/Qwen3.6-35B-A3B").clientType).toBe(
      "openai",
    );
  });

  test("exposes model-specific thinking levels from AgentHub mappings", () => {
    expect(
      resolveLLMModelDefinition("gpt-5.5").capabilities.thinkingLevels,
    ).toEqual([
      ThinkingLevel.NONE,
      ThinkingLevel.LOW,
      ThinkingLevel.MEDIUM,
      ThinkingLevel.HIGH,
      ThinkingLevel.XHIGH,
    ]);
    expect(
      resolveLLMModelDefinition("deepseek-v4-pro").capabilities.thinkingLevels,
    ).toEqual([ThinkingLevel.NONE, ThinkingLevel.HIGH, ThinkingLevel.XHIGH]);
    expect(
      resolveLLMModelDefinition("glm-5.1").capabilities.thinkingLevels,
    ).toEqual([ThinkingLevel.NONE, ThinkingLevel.MEDIUM]);
  });

  test("exposes provider metadata from model definitions", () => {
    expect(resolveLLMModelDefinition("gemini-3.1-pro-preview").provider).toBe(
      "google",
    );
    expect(resolveLLMModelDefinition("gpt-5.5").provider).toBe("openai");
    expect(resolveLLMModelDefinition("claude-sonnet-4-6").provider).toBe(
      "anthropic",
    );
  });

  test("resolves Gemini 3.1 Flash-Lite to the Gemini 3 client route", () => {
    expect(
      resolveLLMModelConfig({
        model: "gemini-3.1-flash-lite",
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.com",
      }),
    ).toEqual({
      model: "gemini-3.1-flash-lite",
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      clientType: "gemini-3",
      capabilities: {
        thinkingLevels: [
          ThinkingLevel.NONE,
          ThinkingLevel.LOW,
          ThinkingLevel.MEDIUM,
          ThinkingLevel.HIGH,
        ],
        tools: true,
        images: true,
      },
      requestDefaults: {
        thinkingLevel: ThinkingLevel.MEDIUM,
        thinkingSummary: true,
        promptCaching: PromptCaching.ENABLE,
      },
    });
  });

  test("rejects disabled thinking for Gemini 3.1 Pro Preview", () => {
    expect(
      resolveLLMModelDefinition("gemini-3.1-pro-preview").capabilities
        .thinkingLevels,
    ).toEqual([ThinkingLevel.LOW, ThinkingLevel.MEDIUM, ThinkingLevel.HIGH]);
    expect(() =>
      resolveLLMModelConfig({
        model: "gemini-3.1-pro-preview",
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.com",
        thinkingLevel: ThinkingLevel.NONE,
      }),
    ).toThrow("gemini-3.1-pro-preview does not support thinking level: none");
  });

  test("resolves Qwen3 without thinking level because it has no level control", () => {
    expect(
      resolveLLMModelConfig({
        model: "qwen3",
        apiKey: "test-key",
        baseUrl: "http://127.0.0.1:8000/v1/",
      }),
    ).toEqual({
      model: "qwen3",
      apiKey: "test-key",
      baseUrl: "http://127.0.0.1:8000/v1/",
      clientType: "openai",
      capabilities: {
        thinkingLevels: [],
        tools: true,
        images: false,
      },
      requestDefaults: {
        promptCaching: PromptCaching.ENABLE,
      },
    });
  });

  test("rejects explicit thinking level for models without level control", () => {
    expect(() =>
      resolveLLMModelConfig({
        model: "qwen3",
        apiKey: "test-key",
        baseUrl: "http://127.0.0.1:8000/v1/",
        thinkingLevel: ThinkingLevel.MEDIUM,
      }),
    ).toThrow("qwen3 does not support thinking level: medium");
  });
});
