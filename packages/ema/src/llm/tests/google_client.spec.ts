import { afterEach, describe, expect, test, vi } from "vitest";

import { GenAI } from "../google_client";

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
        apiVersion: "v1",
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
});
