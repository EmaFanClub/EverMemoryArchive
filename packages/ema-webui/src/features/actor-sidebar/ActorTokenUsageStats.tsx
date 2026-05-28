"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/dashboard/page.module.css";
import type { ActorSummary } from "@/types/dashboard/v1beta1";
import { getActorTokenUsage } from "@/transport/dashboard";
import { subscribeEmaEvents } from "@/transport/events";

import {
  TOKEN_USAGE_RANGE_OPTIONS,
  TOKEN_USAGE_SOURCE_LABELS,
  TOKEN_USAGE_TOOLTIP_METRICS,
  TOKEN_USAGE_TREND_STACK,
  buildTokenUsageAxisTicks,
  buildTokenUsageSegments,
  buildTokenUsageTrendSlots,
  shouldRefreshTokenUsageForEvent,
  type ActorTokenUsageSourceSummary,
  type ActorTokenUsageSummaryResponse,
  type TokenUsageRange,
  type TokenUsageSource,
  type TokenUsageTotals,
} from "./actor-token-usage";

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
    label: "Cache",
    tone: styles.actorStatsToneCacheRead,
  },
  {
    key: "cacheWriteTokens",
    label: "Input",
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
  { key: "cacheReadTokens", shortLabel: "Cache" },
  { key: "cacheWriteTokens", shortLabel: "Input" },
  { key: "outputTokens", shortLabel: "Output" },
  { key: "totalTokens", shortLabel: "Total" },
];

const TOKEN_USAGE_REFRESH_DEBOUNCE_MS = 700;

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

type ActorTokenUsageLoadState =
  | {
      status: "loading";
    }
  | {
      status: "ready";
      actorId: string;
      range: TokenUsageRange;
      summary: ActorTokenUsageSummaryResponse;
    }
  | {
      status: "error";
      actorId: string;
      range: TokenUsageRange;
      message: string;
    };

export function ActorTokenUsageStats({ actor }: { actor: ActorSummary }) {
  const [range, setRange] = useState<TokenUsageRange>("today");
  const [loadState, setLoadState] = useState<ActorTokenUsageLoadState>({
    status: "loading",
  });
  const loadVersionRef = useRef(0);
  const currentLoadState =
    loadState.status !== "loading" &&
    loadState.actorId === actor.id &&
    loadState.range === range
      ? loadState
      : ({ status: "loading" } satisfies ActorTokenUsageLoadState);
  const summary =
    currentLoadState.status === "ready" ? currentLoadState.summary : undefined;
  const sourceItems = useMemo(
    () =>
      [...(summary?.bySource ?? [])].sort(
        (left, right) => right.totalTokens - left.totalTokens,
      ),
    [summary?.bySource],
  );
  const maxDayTokens = Math.max(
    1,
    ...(summary?.trendByDay ?? []).map((day) => day.totalTokens),
  );
  const axisTicks = buildTokenUsageAxisTicks(maxDayTokens);
  const axisMaxTokens = axisTicks[0] || 1;
  const trendSlots = useMemo(
    () => buildTokenUsageTrendSlots(summary?.trendByDay ?? []),
    [summary?.trendByDay],
  );

  const loadTokenUsage = useCallback(
    (signal?: AbortSignal) => {
      const loadVersion = loadVersionRef.current + 1;
      loadVersionRef.current = loadVersion;

      return getActorTokenUsage(actor.id, range, { signal })
        .then((nextSummary) => {
          if (loadVersionRef.current !== loadVersion) {
            return;
          }
          setLoadState({
            status: "ready",
            actorId: actor.id,
            range,
            summary: nextSummary,
          });
        })
        .catch((error) => {
          if (signal?.aborted || loadVersionRef.current !== loadVersion) {
            return;
          }
          setLoadState({
            status: "error",
            actorId: actor.id,
            range,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [actor.id, range],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadTokenUsage(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadTokenUsage]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const subscription = subscribeEmaEvents(
      ["actor.token_usage.changed"],
      (event) => {
        if (!shouldRefreshTokenUsageForEvent(event, actor.id)) {
          return;
        }
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          controller?.abort();
          controller = new AbortController();
          void loadTokenUsage(controller.signal);
        }, TOKEN_USAGE_REFRESH_DEBOUNCE_MS);
      },
    );

    return () => {
      subscription.close();
      if (timer) {
        clearTimeout(timer);
      }
      controller?.abort();
    };
  }, [actor.id, loadTokenUsage]);

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

      {currentLoadState.status === "loading" ? (
        <ActorTokenUsageStatus title="加载中" />
      ) : currentLoadState.status === "error" ? (
        <ActorTokenUsageStatus
          title="加载失败"
          message={currentLoadState.message}
        />
      ) : currentLoadState.summary.total.totalTokens <= 0 ? (
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
                {currentLoadState.summary.rangeLabel}
              </span>
            </header>

            <div className={styles.actorStatsTotalBlock}>
              <strong>
                {formatHeadlineTokenCount(
                  currentLoadState.summary.total.totalTokens,
                )}
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
                    {formatCompactTokenCount(
                      currentLoadState.summary.total[metric.key],
                    )}
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
                {currentLoadState.summary.rangeLabel}
              </span>
            </header>

            <div className={styles.actorStatsSourceList}>
              {sourceItems.map((item) => (
                <ActorTokenUsageSourceItem
                  key={item.source}
                  item={item}
                  totalTokens={currentLoadState.summary.total.totalTokens}
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
                          )} tokens，Cache ${formatTokenCount(
                            slot.cacheReadTokens,
                          )}，Input ${formatTokenCount(
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

function ActorTokenUsageStatus({
  title,
  message,
}: {
  title: string;
  message?: string;
}) {
  return (
    <section className={styles.actorStatsEmpty} aria-label="Token 使用">
      <span>Token 使用</span>
      <strong>{title}</strong>
      {message ? <p>{message}</p> : null}
    </section>
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
  const segments = buildTokenUsageSegments(item);

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
        )}，Cache ${formatTokenCount(item.cacheReadTokens)}，Input ${formatTokenCount(
          item.cacheWriteTokens,
        )}，Output ${formatTokenCount(item.outputTokens)}`}
      >
        <span
          className={`${styles.actorStatsSourceBar} ${SOURCE_TONES[item.source]}`}
          style={{ width: `${percent > 0 ? Math.max(3, percent) : 0}%` }}
        >
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={`${styles.actorStatsSourceSegment} ${
                TREND_BUCKET_TONES[segment.key]
              }`}
              style={{ width: `${segment.percent}%` }}
            />
          ))}
        </span>
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
