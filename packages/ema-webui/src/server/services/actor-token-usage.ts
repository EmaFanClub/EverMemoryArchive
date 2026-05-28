import "server-only";

import { ensureEmaServer } from "../ema-server";
import { toCoreActorId } from "../ema-adapter/ids";
import {
  tokenUsageRangeLabel,
  type ActorTokenUsageDaySummary,
  type ActorTokenUsageSourceSummary,
  type ActorTokenUsageSummaryResponse,
  type TokenUsageRange,
  type TokenUsageSource,
  type TokenUsageTotals,
} from "../../types/dashboard/v1beta1";

const API_VERSION = "v1beta1" as const;

type CoreTokenUsageSourceSummary = TokenUsageTotals & {
  source: TokenUsageSource;
};

type CoreTokenUsageDaySummary = TokenUsageTotals & {
  date: string;
};

type CoreTokenUsageSummary = {
  total: TokenUsageTotals;
  bySource: CoreTokenUsageSourceSummary[];
  byDay: CoreTokenUsageDaySummary[];
};

export async function buildActorTokenUsageResponse(
  actorId: string,
  range: TokenUsageRange,
  now = new Date(),
): Promise<ActorTokenUsageSummaryResponse> {
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const summary = (await server.controller.tokenUsage.getActorSummary(
    coreActorId,
    resolveActorTokenUsageRangeWindow(range, now),
  )) as CoreTokenUsageSummary;

  return {
    apiVersion: API_VERSION,
    actorId,
    range,
    rangeLabel: tokenUsageRangeLabel(range),
    total: summary.total,
    bySource: summary.bySource.map(toWebSourceSummary),
    trendByDay: summary.byDay.map(toWebDaySummary),
  };
}

export function resolveActorTokenUsageRangeWindow(
  range: TokenUsageRange,
  now = new Date(),
): { from?: number; to?: number } {
  if (range === "all") return {};

  const days = range === "today" ? 1 : range === "week" ? 7 : 30;
  const from = startOfLocalDay(now);
  from.setDate(from.getDate() - days + 1);
  const to = startOfLocalDay(now);
  to.setDate(to.getDate() + 1);
  to.setMilliseconds(to.getMilliseconds() - 1);
  return {
    from: from.getTime(),
    to: to.getTime(),
  };
}

function toWebSourceSummary(
  item: CoreTokenUsageSourceSummary,
): ActorTokenUsageSourceSummary {
  return {
    source: item.source,
    cacheReadTokens: item.cacheReadTokens,
    cacheWriteTokens: item.cacheWriteTokens,
    outputTokens: item.outputTokens,
    totalTokens: item.totalTokens,
  };
}

function toWebDaySummary(
  item: CoreTokenUsageDaySummary,
): ActorTokenUsageDaySummary {
  return {
    date: item.date,
    cacheReadTokens: item.cacheReadTokens,
    cacheWriteTokens: item.cacheWriteTokens,
    outputTokens: item.outputTokens,
    totalTokens: item.totalTokens,
  };
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}
