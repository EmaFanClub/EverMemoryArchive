import { afterEach, describe, expect, test, vi } from "vitest";

import {
  GenAI,
  GOOGLE_AI_API_VERSION,
  GoogleClient,
  VERTEX_AI_API_VERSION,
} from "../google_client";
import { DEFAULT_GOOGLE_BASE_URL, GlobalConfig } from "../../config";
import { MemFs } from "../../shared/fs";
import { RetryConfig } from "../retry";

describe("GenAI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    GlobalConfig.resetForTests();
  });

  test("suppresses Google API key env while initializing Vertex AI client", () => {
    vi.stubEnv("GOOGLE_API_KEY", "google-api-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-api-key");
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    new GenAI(
      {
        apiVersion: VERTEX_AI_API_VERSION,
        vertexai: true,
        project: "test-project",
        location: "us-central1",
      },
      async () => new Response("{}"),
    );

    expect(debugSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(
        "The user provided project/location will take precedence",
      ),
    );
    expect(process.env.GOOGLE_API_KEY).toBe("google-api-key");
    expect(process.env.GEMINI_API_KEY).toBe("gemini-api-key");
  });

  test("keeps Google AI mode when Vertex AI env is enabled", async () => {
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "True");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "global");

    const requestedUrls: string[] = [];
    const client = new GenAI(
      {
        apiVersion: GOOGLE_AI_API_VERSION,
        vertexai: false,
        apiKey: "gemini-api-key",
      },
      async (url) => {
        requestedUrls.push(url);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "ok" }],
                  role: "model",
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              totalTokenCount: 1,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    await client.models.generateContent({
      model: "gemini-test",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("generativelanguage.googleapis.com");
    expect(requestedUrls[0]).toContain(`/${GOOGLE_AI_API_VERSION}/`);
    expect(requestedUrls[0]).not.toContain("aiplatform.googleapis.com");
  });

  test("configures Google AI client with the Gemini API beta version", async () => {
    const fs = new MemFs();
    await fs.write(GlobalConfig.configPath, GlobalConfig.example);
    await GlobalConfig.load(fs);

    const client = new GoogleClient(
      {
        model: "gemini-test",
        baseUrl: DEFAULT_GOOGLE_BASE_URL,
        apiKey: "gemini-api-key",
        useVertexAi: false,
        project: "test-project",
        location: "global",
      },
      new RetryConfig(false),
    );

    const apiClient = (client as any).client.apiClient;
    expect(apiClient.isVertexAI()).toBe(false);
    expect(apiClient.getApiVersion()).toBe(GOOGLE_AI_API_VERSION);
    expect(apiClient.getRequestUrl()).toContain(`/${GOOGLE_AI_API_VERSION}`);
  });
});
