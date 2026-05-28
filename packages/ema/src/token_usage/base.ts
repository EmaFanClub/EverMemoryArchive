import type { UsageMetadata } from "../llm/schema";

export const TokenUsageSources = [
  "chat",
  "activity",
  "conversation_rollup",
  "memory_rollup",
  "wake",
  "sleep",
  "training",
] as const;

export type TokenUsageSource = (typeof TokenUsageSources)[number];

export interface TokenUsageContext {
  actorId: number;
  source: TokenUsageSource;
  conversationId?: number;
}

export interface TokenUsageTotals {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function createEmptyTokenUsageTotals(): TokenUsageTotals {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function addTokenUsageTotals(
  target: TokenUsageTotals,
  addition: TokenUsageTotals,
): void {
  target.cacheReadTokens += addition.cacheReadTokens;
  target.cacheWriteTokens += addition.cacheWriteTokens;
  target.outputTokens += addition.outputTokens;
  target.totalTokens += addition.totalTokens;
}

export function normalizeUsageMetadata(
  usageMetadata: UsageMetadata,
): TokenUsageTotals {
  const cacheReadTokens = usageMetadata.cachedTokens ?? 0;
  // AgentHub exposes promptTokens as the non-cached input bucket.
  const cacheWriteTokens = usageMetadata.promptTokens ?? 0;
  const outputTokens =
    (usageMetadata.thoughtTokens ?? 0) + (usageMetadata.responseTokens ?? 0);
  return {
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: cacheReadTokens + cacheWriteTokens + outputTokens,
  };
}
