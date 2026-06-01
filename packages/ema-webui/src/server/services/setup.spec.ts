import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ensureEmaServer = vi.hoisted(() => vi.fn());

vi.mock("../ema-server", () => ({
  ensureEmaServer,
}));

import { runSetupServiceCheck } from "./setup";

describe("setup service checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects unsupported embedding models before probing providers", async () => {
    ensureEmaServer.mockRejectedValue(
      new Error("provider probe should not run"),
    );

    const response = await runSetupServiceCheck("embedding", {
      phase: "step",
      config: {
        model: "unknown-embedding",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "gemini-key",
      },
    });

    expect(response.ok).toBe(false);
    expect(response.check.error).toMatchObject({
      code: "UNSUPPORTED",
      retryable: false,
      details: {
        issuePaths: ["embedding.model"],
        issueCodes: ["unsupported"],
      },
    });
    expect(ensureEmaServer).not.toHaveBeenCalled();
  });

  test("rejects unsupported embedding dimensions before probing providers", async () => {
    ensureEmaServer.mockRejectedValue(
      new Error("provider probe should not run"),
    );

    const response = await runSetupServiceCheck("embedding", {
      phase: "step",
      config: {
        model: "gemini-embedding-2",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "gemini-key",
        dimensions: 512,
      },
    });

    expect(response.ok).toBe(false);
    expect(response.check.error).toMatchObject({
      code: "UNSUPPORTED",
      retryable: false,
      details: {
        issuePaths: ["embedding.dimensions"],
        issueCodes: ["unsupported"],
      },
    });
    expect(ensureEmaServer).not.toHaveBeenCalled();
  });
});
