import { describe, expect, test } from "vitest";

import { PromptCaching, ThinkingLevel } from "../base";
import { resolveLLMModelConfig, resolveLLMModelDefinition } from "../models";

describe("AgentHub model registry", () => {
  test("exposes provider metadata from model definitions", () => {
    expect(resolveLLMModelDefinition("gemini-3.1-pro-preview").provider).toBe(
      "google",
    );
    expect(resolveLLMModelDefinition("gpt-5.5").provider).toBe("openai");
    expect(resolveLLMModelDefinition("claude-sonnet-4-6").provider).toBe(
      "anthropic",
    );
  });

  test("resolves Gemini 3.1 Flash-Lite Preview to the Gemini 3 client route", () => {
    expect(
      resolveLLMModelConfig({
        model: "gemini-3.1-flash-lite-preview",
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.com",
      }),
    ).toEqual({
      model: "gemini-3.1-flash-lite-preview",
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      clientType: "gemini-3-client",
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
      clientType: "qwen3",
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
