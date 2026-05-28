"use client";

import { useMemo, useState } from "react";

import styles from "@/app/dashboard/page.module.css";
import type { ActorSummary } from "@/types/dashboard/v1beta1";

import {
  TOKEN_USAGE_RANGE_OPTIONS,
  TOKEN_USAGE_SOURCE_LABELS,
  TOKEN_USAGE_TOOLTIP_METRICS,
  TOKEN_USAGE_TREND_STACK,
  buildTokenUsageAxisTicks,
  buildTokenUsageTrendSlots,
  createMockActorTokenUsageSummary,
  type ActorTokenUsageSourceSummary,
  type TokenUsageRange,
  type TokenUsageSource,
  type TokenUsageTotals,
} from "./actor-token-usage-mock";

type TokenUsageMetric = {
  key: keyof Pick<
    TokenUsageTotals,
    "cacheReadTokens" | "cacheWriteTokens" | "outputTokens"
  >;
  label: string;
  tone: string;
};

const TOKEN_USAGE_METRICS: TokenUsageMetric[] = [
  {
    key: "cacheReadTokens",
    label: "Cache Read",
    tone: styles.actorStatsToneCacheRead,
  },
  {
    key: "cacheWriteTokens",
    label: "Cache Write",
    tone: styles.actorStatsToneCacheWrite,
  },
  {
    key: "outputTokens",
    label: "Output",
    tone: styles.actorStatsToneOutput,
  },
];

const SOURCE_DETAIL_METRICS: Array<{
  key: keyof TokenUsageTotals;
  shortLabel: string;
}> = [
  { key: "cacheReadTokens", shortLabel: "Read" },
  { key: "cacheWriteTokens", shortLabel: "Write" },
  { key: "outputTokens", shortLabel: "Output" },
  { key: "totalTokens", shortLabel: "Total" },
];

const SOURCE_TONES: Record<TokenUsageSource, string> = {
  chat: styles.actorStatsToneChat,
  activity: styles.actorStatsToneActivity,
  conversation_rollup: styles.actorStatsToneConversationRollup,
  memory_rollup: styles.actorStatsToneMemoryRollup,
  wake: styles.actorStatsToneWake,
  sleep: styles.actorStatsToneSleep,
  training: styles.actorStatsToneTraining,
};

const TREND_BUCKET_TONES: Record<
  (typeof TOKEN_USAGE_TREND_STACK)[number]["key"],
  string
> = {
  cacheReadTokens: styles.actorStatsToneCacheRead,
  cacheWriteTokens: styles.actorStatsToneCacheWrite,
  outputTokens: styles.actorStatsToneOutput,
};

export function ActorTokenUsageStats({ actor }: { actor: ActorSummary }) {
  const [range, setRange] = useState<TokenUsageRange>("today");
  const summary = useMemo(
    () => createMockActorTokenUsageSummary(actor.id, range),
    [actor.id, range],
  );
  const sourceItems = useMemo(
    () =>
      [...summary.bySource].sort(
        (left, right) => right.totalTokens - left.totalTokens,
      ),
    [summary.bySource],
  );
  const maxDayTokens = Math.max(
    1,
    ...summary.trendByDay.map((day) => day.totalTokens),
  );
  const axisTicks = buildTokenUsageAxisTicks(maxDayTokens);
  const axisMaxTokens = axisTicks[0] || 1;
  const trendSlots = useMemo(
    () => buildTokenUsageTrendSlots(summary.trendByDay),
    [summary.trendByDay],
  );

  return (
    <div className={styles.actorStatsPanel}>
      <div
        className={styles.actorStatsRangeTabs}
        role="group"
        aria-label="统计范围"
      >
        {TOKEN_USAGE_RANGE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={range === option.id}
            className={`${styles.actorStatsRangeTab} ${
              range === option.id ? styles.actorStatsRangeTabActive : ""
            }`}
            onClick={() => setRange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {summary.total.totalTokens <= 0 ? (
        <section className={styles.actorStatsEmpty} aria-label="Token 使用">
          <span>Token 使用</span>
          <strong>暂无记录</strong>
        </section>
      ) : (
        <>
          <section
            className={styles.actorStatsCard}
            aria-label="Token 使用总览"
          >
            <header className={styles.actorStatsCardHeader}>
              <div className={styles.actorStatsTitle}>
                <span>Token 使用</span>
                <strong>总计</strong>
              </div>
              <span className={styles.actorStatsRangeBadge}>
                {summary.rangeLabel}
              </span>
            </header>

            <div className={styles.actorStatsTotalBlock}>
              <strong>
                {formatHeadlineTokenCount(summary.total.totalTokens)}
              </strong>
            </div>

            <div className={styles.actorStatsMetricGrid}>
              {TOKEN_USAGE_METRICS.map((metric) => (
                <div key={metric.key} className={styles.actorStatsMetric}>
                  <span
                    className={`${styles.actorStatsMetricAccent} ${metric.tone}`}
                    aria-hidden="true"
                  />
                  <span className={styles.actorStatsMetricLabel}>
                    {metric.label}
                  </span>
                  <strong>
                    {formatCompactTokenCount(summary.total[metric.key])}
                  </strong>
                </div>
              ))}
            </div>
          </section>

          <section
            className={styles.actorStatsCard}
            aria-label="Token 来源分布"
          >
            <header className={styles.actorStatsCardHeader}>
              <div className={styles.actorStatsTitle}>
                <span>来源分布</span>
                <strong>按来源</strong>
              </div>
              <span className={styles.actorStatsRangeBadge}>
                {summary.rangeLabel}
              </span>
            </header>

            <div className={styles.actorStatsSourceList}>
              {sourceItems.map((item) => (
                <ActorTokenUsageSourceItem
                  key={item.source}
                  item={item}
                  totalTokens={summary.total.totalTokens}
                />
              ))}
            </div>
          </section>

          <section
            className={styles.actorStatsCard}
            aria-label="Token 使用趋势"
          >
            <header className={styles.actorStatsCardHeader}>
              <div className={styles.actorStatsTitle}>
                <span>趋势</span>
                <strong>每日总量</strong>
              </div>
            </header>

            <div className={styles.actorStatsTrendPlot}>
              <div className={styles.actorStatsTrendAxis} aria-hidden="true">
                {axisTicks.map((tick) => (
                  <span key={tick}>{formatCompactTokenCount(tick)}</span>
                ))}
              </div>

              <div className={styles.actorStatsTrendChart}>
                {trendSlots.map((slot, index) => {
                  const edgeClass =
                    index <= 1
                      ? styles.actorStatsTrendColumnStart
                      : index >= trendSlots.length - 2
                        ? styles.actorStatsTrendColumnEnd
                        : "";

                  if (slot.kind === "empty") {
                    return (
                      <div
                        key={slot.id}
                        className={`${styles.actorStatsTrendColumn} ${styles.actorStatsTrendColumnEmpty} ${edgeClass}`}
                        aria-hidden="true"
                      />
                    );
                  }

                  const height =
                    slot.totalTokens > 0
                      ? Math.min(
                          100,
                          Math.max(3, (slot.totalTokens / axisMaxTokens) * 100),
                        )
                      : 0;

                  return (
                    <div
                      key={slot.date}
                      className={`${styles.actorStatsTrendColumn} ${edgeClass}`}
                    >
                      <div className={styles.actorStatsTrendBarSlot}>
                        <div
                          className={styles.actorStatsTrendBarWrap}
                          style={{ height: `${height}%` }}
                          role="img"
                          tabIndex={0}
                          aria-label={`${formatDayLabel(slot.date)} ${formatTokenCount(
                            slot.totalTokens,
                          )} tokens，Cache Read ${formatTokenCount(
                            slot.cacheReadTokens,
                          )}，Cache Write ${formatTokenCount(
                            slot.cacheWriteTokens,
                          )}，Output ${formatTokenCount(slot.outputTokens)}`}
                        >
                          <div className={styles.actorStatsTrendTooltip}>
                            <span className={styles.actorStatsTrendTooltipDate}>
                              {formatDayLabel(slot.date)}
                            </span>
                            {TOKEN_USAGE_TOOLTIP_METRICS.map((metric) => (
                              <span
                                key={metric.key}
                                className={styles.actorStatsTrendTooltipRow}
                              >
                                <span>{metric.label}</span>
                                <strong>
                                  {formatCompactTokenCount(slot[metric.key])}
                                </strong>
                              </span>
                            ))}
                          </div>
                          <div className={styles.actorStatsTrendBar}>
                            {TOKEN_USAGE_TREND_STACK.map((bucket) => (
                              <span
                                key={bucket.key}
                                className={`${styles.actorStatsTrendSegment} ${
                                  TREND_BUCKET_TONES[bucket.key]
                                }`}
                                style={{
                                  height: `${toSegmentPercent(
                                    slot[bucket.key],
                                    slot.totalTokens,
                                  )}%`,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <span className={styles.actorStatsTrendLabel}>
                        {formatDayLabel(slot.date)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ActorTokenUsageSourceItem({
  item,
  totalTokens,
}: {
  item: ActorTokenUsageSourceSummary;
  totalTokens: number;
}) {
  const percent = totalTokens > 0 ? (item.totalTokens / totalTokens) * 100 : 0;

  return (
    <div className={styles.actorStatsSourceItem}>
      <div className={styles.actorStatsSourceMeta}>
        <span>{TOKEN_USAGE_SOURCE_LABELS[item.source]}</span>
      </div>
      <div
        className={styles.actorStatsSourceTrack}
        role="img"
        aria-label={`${TOKEN_USAGE_SOURCE_LABELS[item.source]} ${formatPercent(
          percent,
        )}`}
      >
        <span
          className={`${styles.actorStatsSourceBar} ${SOURCE_TONES[item.source]}`}
          style={{ width: `${percent > 0 ? Math.max(3, percent) : 0}%` }}
        />
      </div>
      <div className={styles.actorStatsSourceDetail}>
        {SOURCE_DETAIL_METRICS.map((metric) => (
          <span key={metric.key}>
            {metric.shortLabel}
            <strong>{formatCompactTokenCount(item[metric.key])}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatCompactTokenCount(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(value);
}

function formatHeadlineTokenCount(value: number): string {
  if (value >= 1_000) return `${trimDecimal(value / 1_000)} K`;
  return `${value} tokens`;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function toSegmentPercent(value: number, total: number): number {
  if (total <= 0 || value <= 0) return 0;
  return (value / total) * 100;
}

function formatDayLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
