import {
  TOKEN_USAGE_RANGE_OPTIONS,
  TOKEN_USAGE_SOURCE_LABELS,
  isTokenUsageRange,
  tokenUsageRangeLabel,
  type ActorTokenUsageDaySummary,
  type ActorTokenUsageSourceSummary,
  type ActorTokenUsageSummaryResponse,
  type TokenUsageRange,
  type TokenUsageSource,
  type TokenUsageTotals,
} from "../../types/dashboard/v1beta1";
import type { EmaKnownEvent } from "@/types/events/v1beta1";

export {
  TOKEN_USAGE_RANGE_OPTIONS,
  TOKEN_USAGE_SOURCE_LABELS,
  isTokenUsageRange,
  tokenUsageRangeLabel,
  type ActorTokenUsageDaySummary,
  type ActorTokenUsageSourceSummary,
  type ActorTokenUsageSummaryResponse,
  type TokenUsageRange,
  type TokenUsageSource,
  type TokenUsageTotals,
};

export const TOKEN_USAGE_TREND_STACK = [
  { key: "cacheReadTokens", label: "Cache" },
  { key: "cacheWriteTokens", label: "Input" },
  { key: "outputTokens", label: "Output" },
] as const satisfies Array<{
  key: keyof Pick<
    TokenUsageTotals,
    "cacheReadTokens" | "cacheWriteTokens" | "outputTokens"
  >;
  label: string;
}>;

export const TOKEN_USAGE_TOOLTIP_METRICS = [
  { key: "cacheReadTokens", label: "Cache" },
  { key: "cacheWriteTokens", label: "Input" },
  { key: "outputTokens", label: "Output" },
  { key: "totalTokens", label: "Total" },
] as const satisfies Array<{
  key: keyof TokenUsageTotals;
  label: string;
}>;

export type TokenUsageSegment = {
  key: (typeof TOKEN_USAGE_TREND_STACK)[number]["key"];
  percent: number;
};

export type ActorTokenUsageTrendSlot =
  | {
      kind: "empty";
      id: string;
    }
  | ({
      kind: "day";
    } & ActorTokenUsageDaySummary);

const TREND_DAYS = 7;

export function buildTokenUsageAxisTicks(
  maxTokens: number,
): [number, number, number] {
  const top = roundAxisMax(maxTokens);
  return [top, Math.round(top / 2), 0];
}

export function buildTokenUsageTrendSlots(
  days: ActorTokenUsageDaySummary[],
  slotCount = TREND_DAYS,
): ActorTokenUsageTrendSlot[] {
  const visibleDays = [...days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-slotCount);
  const emptyCount = Math.max(0, slotCount - visibleDays.length);
  return [
    ...Array.from({ length: emptyCount }, (_, index) => ({
      kind: "empty" as const,
      id: `empty-${index}`,
    })),
    ...visibleDays.map((day) => ({
      kind: "day" as const,
      ...day,
    })),
  ];
}

export function buildTokenUsageSegments(
  totals: Pick<
    TokenUsageTotals,
    "cacheReadTokens" | "cacheWriteTokens" | "outputTokens" | "totalTokens"
  >,
): TokenUsageSegment[] {
  if (totals.totalTokens <= 0) {
    return TOKEN_USAGE_TREND_STACK.map((bucket) => ({
      key: bucket.key,
      percent: 0,
    }));
  }
  return TOKEN_USAGE_TREND_STACK.map((bucket) => ({
    key: bucket.key,
    percent: (totals[bucket.key] / totals.totalTokens) * 100,
  }));
}

export function shouldRefreshTokenUsageForEvent(
  event: Pick<EmaKnownEvent, "type" | "actorId">,
  actorId: string,
): boolean {
  return (
    event.type === "actor.token_usage.changed" && event.actorId === actorId
  );
}

function roundAxisMax(value: number): number {
  const normalized = Math.max(1, value);
  const magnitude = 10 ** Math.floor(Math.log10(normalized));
  const fraction = normalized / magnitude;
  const niceFraction = fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}
