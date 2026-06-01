import { afterEach, describe, expect, test, vi } from "vitest";

const streamingResponse = vi.fn();
const autoLLMClient = vi.fn(() => ({ streamingResponse }));

vi.mock("@prismshadow/agenthub", () => ({
  AutoLLMClient: autoLLMClient,
}));

describe("EmbeddingClient", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("requests embeddings through AgentHub", async () => {
    const { EmbeddingClient } = await import("../embedding_client");
    streamingResponse.mockImplementation(async function* () {
      yield {
        role: "assistant",
        event_type: "stop",
        content_items: [{ type: "embedding", embedding: [0.1, 0.2] }],
        usage_metadata: null,
        finish_reason: "stop",
      };
    });

    const client = new EmbeddingClient({
      model: "gemini-embedding-2",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
    });

    await expect(
      client.createEmbedding(undefined, " memory "),
    ).resolves.toEqual([0.1, 0.2]);

    expect(autoLLMClient).toHaveBeenCalledWith({
      model: "gemini-embedding-2",
      apiKey: "gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      clientType: "gemini-embedding",
    });
    expect(streamingResponse).toHaveBeenCalledWith({
      messages: [
        {
          role: "user",
          content_items: [{ type: "text", text: "memory" }],
        },
      ],
      config: {
        embedding_config: { dimensions: 3072 },
      },
    });
  });

  test("uses explicit dimensions when provided by the caller", async () => {
    const { EmbeddingClient } = await import("../embedding_client");
    streamingResponse.mockImplementation(async function* () {
      yield {
        role: "assistant",
        event_type: "stop",
        content_items: [{ type: "embedding", embedding: [0.1] }],
        usage_metadata: null,
        finish_reason: "stop",
      };
    });
    const client = new EmbeddingClient({
      model: "gemini-embedding-2",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
    });

    await client.createEmbedding(768, "memory");

    expect(streamingResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          embedding_config: { dimensions: 768 },
        },
      }),
    );
  });

  test("returns undefined for blank input", async () => {
    const { EmbeddingClient } = await import("../embedding_client");
    const client = new EmbeddingClient({
      model: "gemini-embedding-2",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
    });

    await expect(client.createEmbedding(undefined, "  ")).resolves.toBe(
      undefined,
    );

    expect(streamingResponse).not.toHaveBeenCalled();
  });

  test("rejects empty embedding responses", async () => {
    const { EmbeddingClient } = await import("../embedding_client");
    streamingResponse.mockImplementation(async function* () {
      yield {
        role: "assistant",
        event_type: "stop",
        content_items: [],
        usage_metadata: null,
        finish_reason: "stop",
      };
    });
    const client = new EmbeddingClient({
      model: "gemini-embedding-2",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
    });

    await expect(client.probe()).rejects.toThrow(
      "Embedding provider returned an empty vector.",
    );
  });
});
