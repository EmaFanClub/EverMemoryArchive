import { describe, expect, test, vi } from "vitest";

import { recordAgentTokenUsage } from "../recorder";

describe("recordAgentTokenUsage", () => {
  const usageEvent = {
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
  } as const;

  test("maps AgentHub usage metadata into persisted token buckets", async () => {
    const dbService = {
      tokenUsageDB: {
        createTokenUsageRecord: vi.fn(async () => 1),
      },
    };

    await recordAgentTokenUsage(dbService as any, usageEvent);

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

  test("publishes an actor token usage change event after persisting the record", async () => {
    const dbService = {
      tokenUsageDB: {
        createTokenUsageRecord: vi.fn(async () => 7),
      },
    };
    const event = { type: "actor.token_usage.changed", ts: 1001 };
    const bus = {
      createEvent: vi.fn(() => event),
      publish: vi.fn(),
    };

    await recordAgentTokenUsage(dbService as any, usageEvent, bus as any);

    expect(bus.createEvent).toHaveBeenCalledWith({
      type: "actor.token_usage.changed",
      actorId: 1,
      data: {
        conversationId: 42,
        recordId: 7,
        source: "chat",
      },
    });
    expect(bus.publish).toHaveBeenCalledWith(event);
  });
});
