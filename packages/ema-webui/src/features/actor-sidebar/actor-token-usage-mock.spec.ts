import { describe, expect, test } from "vitest";

import {
  TOKEN_USAGE_RANGE_OPTIONS,
  TOKEN_USAGE_SOURCES,
  TOKEN_USAGE_TOOLTIP_METRICS,
  TOKEN_USAGE_TREND_STACK,
  buildTokenUsageAxisTicks,
  buildTokenUsageTrendSlots,
  createMockActorTokenUsageSummary,
  type ActorTokenUsageDaySummary,
  type TokenUsageTotals,
} from "./actor-token-usage-mock";

describe("createMockActorTokenUsageSummary", () => {
  test("defaults to today's range and builds stable source totals", () => {
    const today = new Date("2026-05-28T12:00:00.000Z");
    const first = createMockActorTokenUsageSummary(
      "actor-alpha",
      "today",
      today,
    );
    const second = createMockActorTokenUsageSummary(
      "actor-alpha",
      "today",
      today,
    );

    expect(second).toEqual(first);
    expect(first.range).toBe("today");
    expect(first.rangeLabel).toBe("今天");
    expect(first.bySource.map((item) => item.source)).toEqual(
      TOKEN_USAGE_SOURCES,
    );
    expect(sumTotals(first.bySource)).toEqual(first.total);
    expect(first.trendByDay).toHaveLength(7);
    expect(first.trendByDay.at(-1)?.date).toBe("2026-05-28");
  });

  test("varies totals between actors", () => {
    const today = new Date("2026-05-28T12:00:00.000Z");
    const alpha = createMockActorTokenUsageSummary(
      "actor-alpha",
      "today",
      today,
    );
    const beta = createMockActorTokenUsageSummary("actor-beta", "today", today);

    expect(beta.total.totalTokens).not.toBe(alpha.total.totalTokens);
  });

  test("uses one range for the headline and source distribution", () => {
    const today = new Date("2026-05-28T12:00:00.000Z");

    for (const option of TOKEN_USAGE_RANGE_OPTIONS) {
      const summary = createMockActorTokenUsageSummary(
        "actor-alpha",
        option.id,
        today,
      );

      expect(summary.rangeLabel).toBe(option.label);
      expect(sumTotals(summary.bySource)).toEqual(summary.total);
    }
  });

  test("increases total tokens as the selected range expands", () => {
    const today = new Date("2026-05-28T12:00:00.000Z");
    const todaySummary = createMockActorTokenUsageSummary(
      "actor-alpha",
      "today",
      today,
    );
    const weekSummary = createMockActorTokenUsageSummary(
      "actor-alpha",
      "week",
      today,
    );
    const monthSummary = createMockActorTokenUsageSummary(
      "actor-alpha",
      "month",
      today,
    );
    const allSummary = createMockActorTokenUsageSummary(
      "actor-alpha",
      "all",
      today,
    );

    expect(weekSummary.total.totalTokens).toBeGreaterThan(
      todaySummary.total.totalTokens,
    );
    expect(monthSummary.total.totalTokens).toBeGreaterThan(
      weekSummary.total.totalTokens,
    );
    expect(allSummary.total.totalTokens).toBeGreaterThan(
      monthSummary.total.totalTokens,
    );
  });

  test("exposes today, week, month, and all range options", () => {
    expect(TOKEN_USAGE_RANGE_OPTIONS.map((option) => option.label)).toEqual([
      "今天",
      "7天",
      "30天",
      "全部",
    ]);
  });

  test("defines the trend stack from bottom to top", () => {
    expect(TOKEN_USAGE_TREND_STACK.map((bucket) => bucket.key)).toEqual([
      "cacheReadTokens",
      "cacheWriteTokens",
      "outputTokens",
    ]);
  });

  test("defines tooltip metrics in display order", () => {
    expect(TOKEN_USAGE_TOOLTIP_METRICS.map((metric) => metric.key)).toEqual([
      "cacheReadTokens",
      "cacheWriteTokens",
      "outputTokens",
      "totalTokens",
    ]);
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

function sumTotals(items: TokenUsageTotals[]): TokenUsageTotals {
  return items.reduce<TokenUsageTotals>(
    (sum, item) => ({
      cacheReadTokens: sum.cacheReadTokens + item.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + item.cacheWriteTokens,
      outputTokens: sum.outputTokens + item.outputTokens,
      totalTokens: sum.totalTokens + item.totalTokens,
    }),
    {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  );
}
