import { describe, expect, test } from "vitest";

import {
  TOKEN_USAGE_RANGE_OPTIONS,
  TOKEN_USAGE_TOOLTIP_METRICS,
  TOKEN_USAGE_TREND_STACK,
  buildTokenUsageAxisTicks,
  buildTokenUsageSegments,
  buildTokenUsageTrendSlots,
  shouldRefreshTokenUsageForEvent,
  isTokenUsageRange,
  tokenUsageRangeLabel,
  type ActorTokenUsageDaySummary,
} from "./actor-token-usage";

describe("actor token usage helpers", () => {
  test("exposes today, week, month, and all range options", () => {
    expect(TOKEN_USAGE_RANGE_OPTIONS.map((option) => option.label)).toEqual([
      "今天",
      "7天",
      "30天",
      "全部",
    ]);
  });

  test("validates token usage ranges", () => {
    expect(isTokenUsageRange("today")).toBe(true);
    expect(isTokenUsageRange("week")).toBe(true);
    expect(isTokenUsageRange("bad")).toBe(false);
    expect(tokenUsageRangeLabel("month")).toBe("30天");
  });

  test("defines the trend stack from bottom to top", () => {
    expect(TOKEN_USAGE_TREND_STACK.map((bucket) => bucket.key)).toEqual([
      "cacheReadTokens",
      "cacheWriteTokens",
      "outputTokens",
    ]);
    expect(TOKEN_USAGE_TREND_STACK.map((bucket) => bucket.label)).toEqual([
      "Cache",
      "Input",
      "Output",
    ]);
  });

  test("defines tooltip metrics in display order", () => {
    expect(TOKEN_USAGE_TOOLTIP_METRICS.map((metric) => metric.key)).toEqual([
      "cacheReadTokens",
      "cacheWriteTokens",
      "outputTokens",
      "totalTokens",
    ]);
    expect(TOKEN_USAGE_TOOLTIP_METRICS.map((metric) => metric.label)).toEqual([
      "Cache",
      "Input",
      "Output",
      "Total",
    ]);
  });

  test("builds source bar segments from cache, input, and output totals", () => {
    expect(
      buildTokenUsageSegments({
        cacheReadTokens: 20,
        cacheWriteTokens: 30,
        outputTokens: 50,
        totalTokens: 100,
      }),
    ).toEqual([
      { key: "cacheReadTokens", percent: 20 },
      { key: "cacheWriteTokens", percent: 30 },
      { key: "outputTokens", percent: 50 },
    ]);
  });

  test("matches token usage change events for the visible actor only", () => {
    expect(
      shouldRefreshTokenUsageForEvent(
        { type: "actor.token_usage.changed", actorId: "1" },
        "1",
      ),
    ).toBe(true);
    expect(
      shouldRefreshTokenUsageForEvent(
        { type: "actor.token_usage.changed", actorId: "2" },
        "1",
      ),
    ).toBe(false);
    expect(
      shouldRefreshTokenUsageForEvent(
        { type: "actor.updated", actorId: "1" },
        "1",
      ),
    ).toBe(false);
  });

  test("builds compact axis ticks above the largest day total", () => {
    expect(buildTokenUsageAxisTicks(76_490)).toEqual([100_000, 50_000, 0]);
    expect(buildTokenUsageAxisTicks(1_900)).toEqual([2_000, 1_000, 0]);
    expect(buildTokenUsageAxisTicks(760_000)).toEqual([1_000_000, 500_000, 0]);
  });

  test("right aligns trend days when fewer than seven days are available", () => {
    const slots = buildTokenUsageTrendSlots([
      createDay("2026-05-26", 100),
      createDay("2026-05-27", 200),
      createDay("2026-05-28", 300),
    ]);

    expect(slots).toHaveLength(7);
    expect(slots.slice(0, 4).map((slot) => slot.kind)).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(
      slots.slice(4).map((slot) => (slot.kind === "day" ? slot.date : "")),
    ).toEqual(["2026-05-26", "2026-05-27", "2026-05-28"]);
  });

  test("uses the latest seven sorted trend days", () => {
    const slots = buildTokenUsageTrendSlots([
      createDay("2026-05-27", 200),
      createDay("2026-05-20", 10),
      createDay("2026-05-28", 300),
      createDay("2026-05-26", 100),
      createDay("2026-05-21", 20),
      createDay("2026-05-22", 30),
      createDay("2026-05-23", 40),
      createDay("2026-05-24", 50),
      createDay("2026-05-25", 60),
    ]);

    expect(slots.map((slot) => (slot.kind === "day" ? slot.date : ""))).toEqual(
      [
        "2026-05-22",
        "2026-05-23",
        "2026-05-24",
        "2026-05-25",
        "2026-05-26",
        "2026-05-27",
        "2026-05-28",
      ],
    );
  });
});

function createDay(
  date: string,
  totalTokens: number,
): ActorTokenUsageDaySummary {
  return {
    date,
    cacheReadTokens: Math.round(totalTokens * 0.2),
    cacheWriteTokens: Math.round(totalTokens * 0.4),
    outputTokens: Math.round(totalTokens * 0.4),
    totalTokens,
  };
}
