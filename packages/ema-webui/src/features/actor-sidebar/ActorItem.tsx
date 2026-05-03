"use client";

import styles from "@/app/dashboard/page.module.css";
import type {
  ActorRuntimeStatus,
  ActorSummary,
} from "@/types/dashboard/v1beta1";

export interface ActorLatestPreview {
  text: string;
  time: number;
  version: number;
}

export interface ActorLatestPreviewState {
  current: ActorLatestPreview;
  exiting?: ActorLatestPreview;
}

const statusText: Record<ActorRuntimeStatus, string> = {
  sleep: "睡眠",
  online: "在线",
  busy: "忙碌",
  offline: "离线",
};
const transitionText = {
  booting: "启动中",
  shutting_down: "关闭中",
  waking: "唤醒中",
  sleeping: "入睡中",
} as const;

function actorAvatarText(name: string) {
  const actorMatch = /^actor\s*(\d+)$/i.exec(name.trim());
  if (actorMatch?.[1]) {
    return `A${actorMatch[1]}`;
  }

  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "A";
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

function buildLocalDateKey(time: number) {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatActorLatestTime(time: number) {
  const date = new Date(time);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const timeLabel = `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;

  if (buildLocalDateKey(time) === buildLocalDateKey(now.getTime())) {
    return timeLabel;
  }

  if (buildLocalDateKey(time) === buildLocalDateKey(yesterday.getTime())) {
    return `昨天 ${timeLabel}`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${month}/${day} ${timeLabel}`;
  }

  return `${date.getFullYear()}/${month}/${day} ${timeLabel}`;
}

export function ActorItem({
  actor,
  active,
  latestPreview,
  unreadCount,
  onSelect,
}: {
  actor: ActorSummary;
  active: boolean;
  latestPreview?: ActorLatestPreviewState;
  unreadCount: number;
  onSelect: () => void;
}) {
  const currentPreview = latestPreview?.current;
  const exitingPreview = latestPreview?.exiting;
  const hasPreview = Boolean(currentPreview || exitingPreview);
  const runtimeStatusLabel = actor.transition
    ? transitionText[actor.transition]
    : statusText[actor.status];
  const runtimeStatusClass = actor.transition ? "preparing" : actor.status;

  function renderPreviewLine(
    preview: ActorLatestPreview,
    state: "current" | "entering" | "exiting",
  ) {
    return (
      <span
        key={`${state}-${preview.version}`}
        className={`${styles.actorPreviewLine} ${
          state === "entering" ? styles.actorPreviewLineEnter : ""
        } ${state === "exiting" ? styles.actorPreviewLineExit : ""}`}
      >
        <span className={styles.actorPreviewText}>{preview.text}</span>
        <time
          className={styles.actorPreviewTime}
          dateTime={new Date(preview.time).toISOString()}
        >
          {formatActorLatestTime(preview.time)}
        </time>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.actorItem} ${active ? styles.actorItemActive : ""} ${
        unreadCount > 0 ? styles.actorItemHasUnread : ""
      } ${!hasPreview ? styles.actorItemNoPreview : ""}`}
      onClick={onSelect}
      title={`${actor.name} · ${currentPreview?.text ?? ""}`.trim()}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.actorAvatar}>
        {actorAvatarText(actor.name)}
        <span
          className={`${styles.statusDot} ${styles[runtimeStatusClass]}`}
          aria-label={runtimeStatusLabel}
        />
      </span>
      <span className={styles.actorCopy}>
        <span className={styles.actorName}>{actor.name}</span>
        {hasPreview ? (
          <span className={styles.actorPreviewViewport}>
            {exitingPreview
              ? renderPreviewLine(exitingPreview, "exiting")
              : null}
            {currentPreview
              ? renderPreviewLine(
                  currentPreview,
                  exitingPreview ? "entering" : "current",
                )
              : null}
          </span>
        ) : null}
      </span>
      {unreadCount > 0 ? (
        <span className={styles.actorUnreadBadge} aria-label="未读消息">
          {formatUnreadCount(unreadCount)}
        </span>
      ) : null}
    </button>
  );
}
