export const TOKEN_USAGE_SOURCES = [
  "chat",
  "activity",
  "conversation_rollup",
  "memory_rollup",
  "wake",
  "sleep",
  "training",
] as const;

export type TokenUsageSource = (typeof TOKEN_USAGE_SOURCES)[number];

export const TOKEN_USAGE_RANGE_OPTIONS = [
  { id: "today", label: "今天" },
  { id: "week", label: "7天" },
  { id: "month", label: "30天" },
  { id: "all", label: "全部" },
] as const;

export type TokenUsageRange = (typeof TOKEN_USAGE_RANGE_OPTIONS)[number]["id"];

export const TOKEN_USAGE_SOURCE_LABELS: Record<TokenUsageSource, string> = {
  chat: "聊天",
  activity: "活动生成",
  conversation_rollup: "会话总结",
  memory_rollup: "记忆整理",
  wake: "唤醒",
  sleep: "睡眠",
  training: "训练",
};

export interface TokenUsageTotals {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const TOKEN_USAGE_TREND_STACK = [
  { key: "cacheReadTokens", label: "Cache Read" },
  { key: "cacheWriteTokens", label: "Cache Write" },
  { key: "outputTokens", label: "Output" },
] as const satisfies Array<{
  key: keyof Pick<
    TokenUsageTotals,
    "cacheReadTokens" | "cacheWriteTokens" | "outputTokens"
  >;
  label: string;
}>;

export const TOKEN_USAGE_TOOLTIP_METRICS = [
  { key: "cacheReadTokens", label: "Cache Read" },
  { key: "cacheWriteTokens", label: "Cache Write" },
  { key: "outputTokens", label: "Output" },
  { key: "totalTokens", label: "Total" },
] as const satisfies Array<{
  key: keyof TokenUsageTotals;
  label: string;
}>;

export interface ActorTokenUsageSourceSummary extends TokenUsageTotals {
  source: TokenUsageSource;
}

export interface ActorTokenUsageDaySummary extends TokenUsageTotals {
  date: string;
}

export type ActorTokenUsageTrendSlot =
  | {
      kind: "empty";
      id: string;
    }
  | ({
      kind: "day";
    } & ActorTokenUsageDaySummary);

export interface ActorTokenUsageSummary {
  range: TokenUsageRange;
  rangeLabel: string;
  total: TokenUsageTotals;
  bySource: ActorTokenUsageSourceSummary[];
  trendByDay: ActorTokenUsageDaySummary[];
}

interface ActorTokenUsageDaySourceSummary extends TokenUsageTotals {
  date: string;
  source: TokenUsageSource;
}

const MOCK_HISTORY_DAYS = 90;
const MONTH_DAYS = 30;
const TREND_DAYS = 7;

const SOURCE_PROFILES: Record<
  TokenUsageSource,
  {
    scale: number;
    cacheReadRatio: number;
    cacheWriteRatio: number;
  }
> = {
  chat: { scale: 1.68, cacheReadRatio: 0.24, cacheWriteRatio: 0.42 },
  activity: { scale: 1.08, cacheReadRatio: 0.18, cacheWriteRatio: 0.46 },
  conversation_rollup: {
    scale: 0.74,
    cacheReadRatio: 0.34,
    cacheWriteRatio: 0.38,
  },
  memory_rollup: { scale: 0.62, cacheReadRatio: 0.4, cacheWriteRatio: 0.34 },
  wake: { scale: 0.36, cacheReadRatio: 0.28, cacheWriteRatio: 0.44 },
  sleep: { scale: 0.28, cacheReadRatio: 0.3, cacheWriteRatio: 0.43 },
  training: { scale: 0.92, cacheReadRatio: 0.2, cacheWriteRatio: 0.54 },
};

export function createMockActorTokenUsageSummary(
  actorId: string,
  range: TokenUsageRange = "today",
  today = new Date(),
): ActorTokenUsageSummary {
  const seed = hashString(actorId || "actor");
  const records = createMockUsageRecords(seed, today);
  const selectedDates = selectRangeDates(today, range);
  const selectedDateSet = new Set(selectedDates);
  const selectedRecords = records.filter((record) =>
    selectedDateSet.has(record.date),
  );
  const bySource = TOKEN_USAGE_SOURCES.map((source) => ({
    source,
    ...sumTotals(selectedRecords.filter((record) => record.source === source)),
  }));
  const trendDates = selectRecentDates(today, TREND_DAYS);
  const trendByDay = trendDates.map((date) => ({
    date,
    ...sumTotals(records.filter((record) => record.date === date)),
  }));
  const total = sumTotals(bySource);

  return {
    range,
    rangeLabel: getRangeLabel(range),
    total,
    bySource,
    trendByDay,
  };
}

function createMockUsageRecords(
  seed: number,
  today: Date,
): ActorTokenUsageDaySourceSummary[] {
  return selectRecentDates(today, MOCK_HISTORY_DAYS).flatMap((date, dayIndex) =>
    TOKEN_USAGE_SOURCES.map((source, sourceIndex) =>
      createSourceDaySummary(source, seed, dayIndex, sourceIndex, date),
    ),
  );
}

function createSourceDaySummary(
  source: TokenUsageSource,
  seed: number,
  dayIndex: number,
  sourceIndex: number,
  date: string,
): ActorTokenUsageDaySourceSummary {
  const profile = SOURCE_PROFILES[source];
  const age = MOCK_HISTORY_DAYS - dayIndex - 1;
  const recency = 1.08 - Math.min(age, 20) * 0.014;
  const weekdayRhythm = 0.76 + ((dayIndex + (seed % 4)) % 5) * 0.08;
  const noise =
    0.72 + random01(seed + dayIndex * 1409 + sourceIndex * 811) * 0.7;
  const base =
    1320 + randomInt(seed + dayIndex * 577 + sourceIndex * 2027, 0, 880);
  const totalTokens = roundTo(
    base * profile.scale * recency * weekdayRhythm * noise,
    10,
  );
  const cacheReadTokens = roundTo(totalTokens * profile.cacheReadRatio, 10);
  const cacheWriteTokens = roundTo(totalTokens * profile.cacheWriteRatio, 10);
  const outputTokens = Math.max(
    0,
    totalTokens - cacheReadTokens - cacheWriteTokens,
  );

  return {
    date,
    source,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalTokens: cacheReadTokens + cacheWriteTokens + outputTokens,
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

function selectRangeDates(today: Date, range: TokenUsageRange): string[] {
  if (range === "today") return selectRecentDates(today, 1);
  if (range === "week") return selectRecentDates(today, TREND_DAYS);
  if (range === "month") return selectRecentDates(today, MONTH_DAYS);
  return selectRecentDates(today, MOCK_HISTORY_DAYS);
}

function selectRecentDates(today: Date, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    formatDateOffset(today, index - count + 1),
  );
}

function getRangeLabel(range: TokenUsageRange): string {
  return (
    TOKEN_USAGE_RANGE_OPTIONS.find((option) => option.id === range)?.label ??
    "今天"
  );
}

function roundAxisMax(value: number): number {
  const normalized = Math.max(1, value);
  const magnitude = 10 ** Math.floor(Math.log10(normalized));
  const fraction = normalized / magnitude;
  const niceFraction = fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomInt(seed: number, min: number, max: number): number {
  return Math.floor(random01(seed) * (max - min + 1)) + min;
}

function random01(seed: number): number {
  let value = seed >>> 0;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatDateOffset(today: Date, offsetDays: number): string {
  const date = new Date(today);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
