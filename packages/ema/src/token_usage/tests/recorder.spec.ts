import { describe, expect, test, vi } from "vitest";

import { recordAgentTokenUsage } from "../recorder";

describe("recordAgentTokenUsage", () => {
  test("maps AgentHub usage metadata into persisted token buckets", async () => {
    const dbService = {
      tokenUsageDB: {
        createTokenUsageRecord: vi.fn(async () => 1),
      },
    };

    await recordAgentTokenUsage(dbService as any, {
      createdAt: 1000,
      model: "gpt-5.5",
      usageContext: {
        actorId: 1,
        conversationId: 42,
        source: "chat",
      },
      usageMetadata: {
        cachedTokens: 2,
        promptTokens: 3,
        thoughtTokens: 5,
        responseTokens: 7,
      },
    });

    expect(dbService.tokenUsageDB.createTokenUsageRecord).toHaveBeenCalledWith({
      actorId: 1,
      conversationId: 42,
      createdAt: 1000,
      source: "chat",
      model: "gpt-5.5",
      cacheReadTokens: 2,
      cacheWriteTokens: 3,
      outputTokens: 12,
      totalTokens: 17,
    });
  });
});
