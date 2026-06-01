import { describe, expect, test } from "vitest";

import {
  listEmbeddingModelDefinitions,
  resolveEmbeddingModelConfig,
  resolveEmbeddingModelDefinition,
} from "../embedding_models";

describe("AgentHub embedding model registry", () => {
  test("defaults to Gemini Embedding 2 metadata", () => {
    expect(resolveEmbeddingModelDefinition("gemini-embedding-2")).toEqual({
      model: "gemini-embedding-2",
      provider: "google",
      clientType: "gemini-embedding",
      defaultBaseUrl: "https://generativelanguage.googleapis.com",
      capabilities: {
        dimensions: [768, 1536, 3072],
      },
      requestDefaults: {
        dimensions: 3072,
      },
    });
  });

  test("resolves user config with registry metadata", () => {
    expect(
      resolveEmbeddingModelConfig({
        model: "gemini-embedding-2",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "gemini-key",
      }),
    ).toEqual({
      model: "gemini-embedding-2",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "gemini-key",
      dimensions: 3072,
      clientType: "gemini-embedding",
      provider: "google",
      capabilities: {
        dimensions: [768, 1536, 3072],
      },
      requestDefaults: {
        dimensions: 3072,
      },
    });
  });

  test("lists detached model definitions", () => {
    const definitions = listEmbeddingModelDefinitions();

    expect(definitions.map((definition) => definition.model)).toEqual([
      "gemini-embedding-2",
      "gemini-embedding-001",
    ]);
    definitions[0]!.capabilities.dimensions.push(512);
    expect(
      resolveEmbeddingModelDefinition("gemini-embedding-2").capabilities
        .dimensions,
    ).toEqual([768, 1536, 3072]);
  });

  test("keeps request defaults separate from requested dimensions", () => {
    expect(
      resolveEmbeddingModelConfig({
        model: "gemini-embedding-2",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "gemini-key",
        dimensions: 768,
      }),
    ).toMatchObject({
      dimensions: 768,
      requestDefaults: {
        dimensions: 3072,
      },
    });
  });

  test("rejects unknown embedding models", () => {
    expect(() =>
      resolveEmbeddingModelConfig({
        model: "text-embedding-3-large",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
      }),
    ).toThrow("Unsupported embedding model: text-embedding-3-large");
  });
});
