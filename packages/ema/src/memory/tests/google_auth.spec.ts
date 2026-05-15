import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildGoogleVertexAIOptions,
  GenAI,
  GOOGLE_AI_API_VERSION,
  GOOGLE_VERTEX_AI_SCOPE,
  VERTEX_AI_API_VERSION,
} from "../google_auth";

describe("GenAI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  test("uses provided Vertex AI credentials JSON without key file fallback", () => {
    const options = buildGoogleVertexAIOptions({
      credentialsJson:
        '{"type":"service_account","project_id":"test-project","client_email":"svc@example.com"}',
    });

    const googleAuthOptions = options.googleAuthOptions!;
    expect(options.project).toBe("test-project");
    expect(options.location).toBe("global");
    expect(googleAuthOptions).toEqual({
      credentials: {
        type: "service_account",
        project_id: "test-project",
        client_email: "svc@example.com",
      },
      scopes: [GOOGLE_VERTEX_AI_SCOPE],
    });
    expect(googleAuthOptions).not.toHaveProperty("keyFile");
    expect(googleAuthOptions).not.toHaveProperty("keyFilename");
  });

  test("requires Vertex AI credentials JSON", () => {
    expect(() =>
      buildGoogleVertexAIOptions({
        credentialsJson: "",
      }),
    ).toThrow("Google Vertex AI credentials JSON is required.");
  });

  test("requires Vertex AI project_id in credentials JSON", () => {
    expect(() =>
      buildGoogleVertexAIOptions({
        credentialsJson:
          '{"type":"service_account","client_email":"svc@example.com"}',
      }),
    ).toThrow("Google Vertex AI credentials JSON must include project_id.");
  });
});
