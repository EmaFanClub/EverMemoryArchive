"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Brain,
  CalendarDays,
  ChartColumn,
  FileClock,
  Moon,
  Settings,
  Sunrise,
} from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import type { ActorSummary } from "@/types/dashboard/v1beta1";

const SLEEP_AXIS_MINUTES = 24 * 60;
const SLEEP_AXIS_CLOCK_OFFSET_MINUTES = 12 * 60;

export type ActorSideTabId =
  | "schedule"
  | "memory"
  | "logs"
  | "stats"
  | "settings";

export function ActorSidePanel({
  actor,
  hidden = false,
  activeTab,
  defaultTab = "schedule",
  onActiveTabChange,
  renderSettings,
}: {
  actor: ActorSummary;
  hidden?: boolean;
  activeTab?: ActorSideTabId;
  defaultTab?: ActorSideTabId;
  onActiveTabChange?: (tab: ActorSideTabId) => void;
  renderSettings: () => ReactNode;
}) {
  const [internalActiveTab, setInternalActiveTab] =
    useState<ActorSideTabId>(defaultTab);
  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const actorName = actor.name;
  const tabs: Array<{
    id: ActorSideTabId;
    label: string;
    icon: ActorSideTabId;
  }> = [
    { id: "schedule", label: "日程", icon: "schedule" },
    { id: "memory", label: "记忆", icon: "memory" },
    { id: "logs", label: "日志", icon: "logs" },
    { id: "stats", label: "统计", icon: "stats" },
    { id: "settings", label: "设置", icon: "settings" },
  ];
  const activeTabLabel =
    tabs.find((tab) => tab.id === resolvedActiveTab)?.label ?? "信息";

  function changeTab(tab: ActorSideTabId) {
    if (!activeTab) {
      setInternalActiveTab(tab);
    }
    onActiveTabChange?.(tab);
  }

  return (
    <section
      className={`${styles.actorInfoPanel} ${
        hidden ? styles.actorInfoPanelHidden : ""
      }`}
      aria-label={`${actorName} 信息`}
      aria-hidden={hidden}
    >
      <div
        className={styles.actorInfoTabs}
        role="tablist"
        aria-label="信息面板"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={resolvedActiveTab === tab.id}
            className={`${styles.actorInfoTab} ${
              resolvedActiveTab === tab.id ? styles.actorInfoTabActive : ""
            }`}
            tabIndex={hidden ? -1 : undefined}
            onClick={() => changeTab(tab.id)}
          >
            <ActorSidePanelIcon name={tab.icon} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div
        className={styles.actorInfoBody}
        role="tabpanel"
        aria-label={activeTabLabel}
      >
        {resolvedActiveTab === "settings" ? (
          renderSettings()
        ) : resolvedActiveTab === "schedule" ? (
          <ActorSchedulePreview actor={actor} />
        ) : (
          <div className={styles.actorInfoComingSoon}>
            <span>{activeTabLabel}</span>
            <strong>Coming soon</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function ActorSchedulePreview({ actor }: { actor: ActorSummary }) {
  return (
    <div className={styles.actorSchedulePanel}>
      <ActorSleepSchedulePreview schedule={actor.sleepSchedule} />
      <div className={styles.actorInfoComingSoon}>
        <span>日程</span>
        <strong>Coming soon</strong>
      </div>
    </div>
  );
}

function ActorSleepSchedulePreview({
  schedule,
}: {
  schedule?: ActorSummary["sleepSchedule"];
}) {
  const [nowAxisMin, setNowAxisMin] = useState(computeCurrentAxisMinutes);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowAxisMin(computeCurrentAxisMinutes());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!schedule) {
    return (
      <section className={styles.actorSleepScheduleCard}>
        <div className={styles.actorSleepScheduleHeader}>
          <span>作息</span>
          <strong>未配置</strong>
        </div>
        <p className={styles.actorSleepScheduleEmpty}>
          角色还没有稳定的入睡与唤醒时间。
        </p>
      </section>
    );
  }

  const startPercent = (schedule.startMinutes / SLEEP_AXIS_MINUTES) * 100;
  const endPercent = (schedule.endMinutes / SLEEP_AXIS_MINUTES) * 100;
  const nowPercent = (nowAxisMin / SLEEP_AXIS_MINUTES) * 100;
  const ticks = [0, 6, 12, 18, 24];

  return (
    <section className={styles.actorSleepScheduleCard} aria-label="作息">
      <div className={styles.actorSleepScheduleHeader}>
        <span>作息</span>
        <strong>
          {formatSleepDuration(schedule.startMinutes, schedule.endMinutes)}
        </strong>
      </div>
      <div className={styles.actorSleepScheduleSummary}>
        <span>
          <Moon aria-hidden="true" />
          入睡 {axisMinutesToClockLabel(schedule.startMinutes)}
        </span>
        <span>
          <Sunrise aria-hidden="true" />
          唤醒 {axisMinutesToClockLabel(schedule.endMinutes)}
        </span>
      </div>
      <div className={styles.actorSleepScheduleTrackWrap}>
        <div className={styles.actorSleepScheduleTrack}>
          <div className={styles.actorSleepScheduleTicks} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick}
                className={styles.actorSleepScheduleTick}
                style={{ left: `${(tick / 24) * 100}%` }}
              />
            ))}
          </div>
          <span
            className={styles.actorSleepScheduleRange}
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
            }}
            aria-hidden="true"
          />
          <span
            className={styles.actorSleepScheduleNow}
            style={{ left: `${nowPercent}%` }}
            aria-label={`现在 ${axisMinutesToClockLabel(nowAxisMin)}`}
          />
          <span
            className={`${styles.actorSleepScheduleHandle} ${styles.actorSleepScheduleHandleStart}`}
            style={{ left: `${startPercent}%` }}
            aria-hidden="true"
          >
            <Moon />
          </span>
          <span
            className={`${styles.actorSleepScheduleHandle} ${styles.actorSleepScheduleHandleEnd}`}
            style={{ left: `${endPercent}%` }}
            aria-hidden="true"
          >
            <Sunrise />
          </span>
        </div>
        <div className={styles.actorSleepScheduleAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ left: `${(tick / 24) * 100}%` }}>
              {axisMinutesToClockLabel(tick * 60)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function axisMinutesToClockLabel(value: number) {
  const axis =
    ((value % SLEEP_AXIS_MINUTES) +
      SLEEP_AXIS_MINUTES +
      SLEEP_AXIS_CLOCK_OFFSET_MINUTES) %
    SLEEP_AXIS_MINUTES;
  const hour = Math.floor(axis / 60);
  const minute = axis % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatSleepDuration(startMin: number, endMin: number) {
  const total = Math.max(0, endMin - startMin);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function computeCurrentAxisMinutes() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (
    (minutes - SLEEP_AXIS_CLOCK_OFFSET_MINUTES + SLEEP_AXIS_MINUTES) %
    SLEEP_AXIS_MINUTES
  );
}

function ActorSidePanelIcon({ name }: { name: ActorSideTabId }) {
  if (name === "schedule") return <CalendarDays aria-hidden="true" />;
  if (name === "memory") return <Brain aria-hidden="true" />;
  if (name === "logs") return <FileClock aria-hidden="true" />;
  if (name === "stats") return <ChartColumn aria-hidden="true" />;
  return <Settings aria-hidden="true" />;
}
