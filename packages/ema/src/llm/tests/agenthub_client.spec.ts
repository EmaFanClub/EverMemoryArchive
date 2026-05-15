import path from "node:path";

import type { UniMessage } from "@prismshadow/agenthub";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createBootstrapConfig, GlobalConfig } from "../../config";
import { MemFs } from "../../shared/fs";
import { AgentHubClient } from "../agenthub_client";
import type { LLMModelConfig } from "../base";
import { PromptCaching, ThinkingLevel } from "../base";
import { RetryConfig } from "../retry";

const ORIGINAL_AGENTHUB_CACHE_DIR = process.env.AGENTHUB_CACHE_DIR;

describe("AgentHubClient", () => {
  afterEach(() => {
    if (ORIGINAL_AGENTHUB_CACHE_DIR === undefined) {
      delete process.env.AGENTHUB_CACHE_DIR;
    } else {
      process.env.AGENTHUB_CACHE_DIR = ORIGINAL_AGENTHUB_CACHE_DIR;
    }
    vi.restoreAllMocks();
    GlobalConfig.resetForTests();
  });

  test("configures AgentHub trace output under EMA logs", async () => {
    const client = await createClient("/tmp/ema-agenthub-test");

    expect(client).toBeInstanceOf(AgentHubClient);
    expect(process.env.AGENTHUB_CACHE_DIR).toBe(
      path.join(GlobalConfig.paths.logsDir, "agent"),
    );
  });

  test("adapts EMA messages to AgentHub content items", async () => {
    const client = await createClient();

    expect(
      client.adaptMessageToSDK({
        role: "model",
        contents: [
          {
            type: "text",
            text: "hello",
            phase: "answer",
            signature: "text-signature",
          },
          {
            type: "thinking",
            thinking: "reasoning",
            signature: "thinking-signature",
          },
          {
            type: "tool_call",
            name: "search",
            arguments: { query: "ema" },
            toolCallId: "call-1",
            signature: "tool-signature",
          },
        ],
        metadata: {
          createdAt: 1_700_000_000_000,
          finishReason: "tool_call",
          usageMetadata: {
            cachedTokens: 1,
            promptTokens: 2,
            thoughtTokens: 3,
            responseTokens: 4,
          },
        },
      }),
    ).toEqual({
      role: "assistant",
      content_items: [
        {
          type: "text",
          text: "hello",
          phase: "answer",
          signature: "text-signature",
        },
        {
          type: "thinking",
          thinking: "reasoning",
          signature: "thinking-signature",
        },
        {
          type: "tool_call",
          name: "search",
          arguments: { query: "ema" },
          tool_call_id: "call-1",
          signature: "tool-signature",
        },
      ],
      created_at: 1_700_000_000_000,
      finish_reason: "tool_call",
      usage_metadata: {
        cached_tokens: 1,
        prompt_tokens: 2,
        thoughts_tokens: 3,
        response_tokens: 4,
      },
    });
  });

  test("adapts ordinary inline images to AgentHub image URLs", async () => {
    const client = await createClient();

    expect(
      client.adaptMessageToSDK({
        role: "user",
        contents: [
          {
            type: "inline_data",
            mimeType: "image/png",
            data: "aW1hZ2U=",
          },
        ],
      }).content_items,
    ).toEqual([
      {
        type: "image_url",
        image_url: "data:image/png;base64,aW1hZ2U=",
      },
    ]);
  });

  test("keeps signed or non-image inline data in AgentHub inline data form", async () => {
    const client = await createClient();

    const message = client.adaptMessageToSDK({
      role: "user",
      contents: [
        {
          type: "inline_data",
          mimeType: "image/png",
          data: "c2lnbmVkLWltYWdl",
          signature: "image-signature",
        },
        {
          type: "inline_data",
          mimeType: "text/plain",
          data: "dGV4dA==",
        },
      ],
    });

    expect(message.content_items).toEqual([
      {
        type: "inline_data",
        data: Buffer.from("c2lnbmVkLWltYWdl", "base64"),
        mime_type: "image/png",
        signature: "image-signature",
      },
      {
        type: "inline_data",
        data: Buffer.from("dGV4dA==", "base64"),
        mime_type: "text/plain",
        signature: undefined,
      },
    ]);
  });

  test("adapts AgentHub response metadata into the message", async () => {
    const client = await createClient();
    const message = client.adaptResponseFromSDK({
      role: "assistant",
      content_items: [
        {
          type: "text",
          text: "done",
          phase: "final",
          signature: "text-signature",
        },
        {
          type: "inline_data",
          data: Buffer.from("image-bytes"),
          mime_type: "image/png",
          signature: "image-signature",
        },
      ],
      finish_reason: "stop",
      created_at: 1_700_000_000_000,
      usage_metadata: {
        cached_tokens: 1,
        prompt_tokens: 2,
        thoughts_tokens: 3,
        response_tokens: 4,
      },
    });

    expect(message).toEqual({
      role: "model",
      contents: [
        {
          type: "text",
          text: "done",
          phase: "final",
          signature: "text-signature",
        },
        {
          type: "inline_data",
          data: Buffer.from("image-bytes").toString("base64"),
          mimeType: "image/png",
          signature: "image-signature",
        },
      ],
      metadata: {
        finishReason: "stop",
        createdAt: 1_700_000_000_000,
        usageMetadata: {
          cachedTokens: 1,
          promptTokens: 2,
          thoughtTokens: 3,
          responseTokens: 4,
        },
      },
    });
  });

  test("rejects unsupported AgentHub response content", async () => {
    const client = await createClient();

    expect(() =>
      client.adaptResponseFromSDK({
        role: "assistant",
        content_items: [
          {
            type: "inline_data",
            data: Buffer.from("json"),
            mime_type: "application/json",
          },
        ],
      }),
    ).toThrow("AgentHub returned unsupported MIME type: application/json");

    expect(() =>
      client.adaptResponseFromSDK({
        role: "assistant",
        content_items: [
          {
            type: "tool_result",
            text: "result",
            tool_call_id: "call-1",
          },
        ],
      }),
    ).toThrow(
      "AgentHub returned tool_result in an assistant response, which EMA does not support.",
    );

    expect(() =>
      client.adaptResponseFromSDK({
        role: "assistant",
        content_items: [
          {
            type: "inline_thinking",
            data: Buffer.from("thinking"),
            mime_type: "application/octet-stream",
          },
        ],
      } satisfies UniMessage),
    ).toThrow(
      "AgentHub returned inline_thinking, which is not supported by EMA schema yet.",
    );
  });
});

async function createClient(
  dataRoot: string = "/tmp/ema-agenthub-test",
): Promise<AgentHubClient> {
  await GlobalConfig.load(new MemFs(), {
    bootstrap: createBootstrapConfig({
      mode: "dev",
      mongoKind: "memory",
      dataRoot,
    }),
  });
  return new AgentHubClient(createModelConfig(), new RetryConfig(false));
}

function createModelConfig(): LLMModelConfig {
  return {
    model: "gpt-5.5",
    apiKey: "test-key",
    baseUrl: "https://api.openai.com/v1",
    clientType: "gpt-5.5",
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
  };
}
