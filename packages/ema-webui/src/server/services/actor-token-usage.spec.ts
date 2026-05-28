import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ensureEmaServer = vi.hoisted(() => vi.fn());

vi.mock("../ema-server", () => ({
  ensureEmaServer,
}));

import {
  buildActorTokenUsageResponse,
  resolveActorTokenUsageRangeWindow,
} from "./actor-token-usage";

describe("actor token usage service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("maps week range summaries from EMA into the WebUI response shape", async () => {
    const getActorSummary = vi.fn(async () => ({
      total: {
        cacheReadTokens: 10,
        cacheWriteTokens: 20,
        outputTokens: 30,
        totalTokens: 60,
      },
      bySource: [
        {
          source: "chat",
          cacheReadTokens: 4,
          cacheWriteTokens: 5,
          outputTokens: 6,
          totalTokens: 15,
        },
      ],
      byDay: [
        {
          date: "2026-05-28",
          cacheReadTokens: 10,
          cacheWriteTokens: 20,
          outputTokens: 30,
          totalTokens: 60,
        },
      ],
    }));
    ensureEmaServer.mockResolvedValueOnce({
      controller: {
        tokenUsage: {
          getActorSummary,
        },
      },
    });
    const now = new Date(2026, 4, 28, 12, 0, 0, 0);

    await expect(
      buildActorTokenUsageResponse("12", "week", now),
    ).resolves.toEqual({
      apiVersion: "v1beta1",
      actorId: "12",
      range: "week",
      rangeLabel: "7天",
      total: {
        cacheReadTokens: 10,
        cacheWriteTokens: 20,
        outputTokens: 30,
        totalTokens: 60,
      },
      bySource: [
        {
          source: "chat",
          cacheReadTokens: 4,
          cacheWriteTokens: 5,
          outputTokens: 6,
          totalTokens: 15,
        },
      ],
      trendByDay: [
        {
          date: "2026-05-28",
          cacheReadTokens: 10,
          cacheWriteTokens: 20,
          outputTokens: 30,
          totalTokens: 60,
        },
      ],
    });
    expect(getActorSummary).toHaveBeenCalledWith(12, {
      from: new Date(2026, 4, 22, 0, 0, 0, 0).getTime(),
      to: new Date(2026, 4, 28, 23, 59, 59, 999).getTime(),
    });
  });

  test("does not constrain all-time summaries", async () => {
    const getActorSummary = vi.fn(async () => ({
      total: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      bySource: [],
      byDay: [],
    }));
    ensureEmaServer.mockResolvedValueOnce({
      controller: {
        tokenUsage: {
          getActorSummary,
        },
      },
    });

    await buildActorTokenUsageResponse("7", "all");

    expect(getActorSummary).toHaveBeenCalledWith(7, {});
  });

  test("resolves calendar-day windows for bounded ranges", () => {
    const now = new Date(2026, 4, 28, 12, 30, 0, 0);

    expect(resolveActorTokenUsageRangeWindow("today", now)).toEqual({
      from: new Date(2026, 4, 28, 0, 0, 0, 0).getTime(),
      to: new Date(2026, 4, 28, 23, 59, 59, 999).getTime(),
    });
    expect(resolveActorTokenUsageRangeWindow("month", now)).toEqual({
      from: new Date(2026, 3, 29, 0, 0, 0, 0).getTime(),
      to: new Date(2026, 4, 28, 23, 59, 59, 999).getTime(),
    });
  });
});
