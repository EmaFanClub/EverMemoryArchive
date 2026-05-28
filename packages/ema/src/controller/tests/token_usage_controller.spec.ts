import { describe, expect, test, vi } from "vitest";

import { TokenUsageController } from "../token_usage_controller";

describe("TokenUsageController", () => {
  test("returns actor token usage summary from the token usage store", async () => {
    const summary = {
      total: {
        cacheReadTokens: 1,
        cacheWriteTokens: 2,
        outputTokens: 3,
        totalTokens: 6,
      },
      bySource: [],
      byDay: [],
    };
    const server = {
      dbService: {
        actorDB: {
          getActor: vi.fn(async () => ({ id: 1, roleId: 1, enabled: true })),
        },
        tokenUsageDB: {
          summarizeActorTokenUsage: vi.fn(async () => summary),
        },
      },
    };
    const controller = new TokenUsageController(server as any);

    await expect(
      controller.getActorSummary(1, { from: 1000, to: 2000 }),
    ).resolves.toBe(summary);
    expect(
      server.dbService.tokenUsageDB.summarizeActorTokenUsage,
    ).toHaveBeenCalledWith({
      actorId: 1,
      from: 1000,
      to: 2000,
    });
  });

  test("rejects missing actors before reading token usage", async () => {
    const server = {
      dbService: {
        actorDB: {
          getActor: vi.fn(async () => null),
        },
        tokenUsageDB: {
          summarizeActorTokenUsage: vi.fn(),
        },
      },
    };
    const controller = new TokenUsageController(server as any);

    await expect(controller.getActorSummary(1)).rejects.toThrow(
      "Actor not found.",
    );
    expect(
      server.dbService.tokenUsageDB.summarizeActorTokenUsage,
    ).not.toHaveBeenCalled();
  });
});
