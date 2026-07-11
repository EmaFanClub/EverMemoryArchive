"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCcw, Save, Trash2, X } from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import {
  deleteActorSchedule,
  getActorSchedules,
  patchActorSchedule,
} from "@/transport/dashboard";
import type {
  ActorScheduleGroupId,
  ActorScheduleListItem,
  ActorScheduleListResponse,
} from "@/types/dashboard/v1beta1";

import {
  SCHEDULE_GROUPS,
  SCHEDULE_TASK_LABELS,
  formatFocusedScheduleSessionLabel,
  formatScheduleIntervalLabel,
  formatSchedulePreview,
  formatScheduleSessionLabel,
  formatScheduleTimeLabel,
  formatScheduleTitle,
  getScheduleGroupsForActor,
  hasReadonlyScheduleDetails,
  isValidScheduleRunAt,
  isVisibleScheduleInGroup,
} from "./actor-schedule-memory";

interface ScheduleDraft {
  summary: string;
  prompt: string;
  runAt: string;
  error: string | null;
}

export function ActorSchedulePanel({ actorId }: { actorId: string }) {
  const activeActorRef = useRef(actorId);
  const actorGenerationRef = useRef(0);
  if (activeActorRef.current !== actorId) {
    activeActorRef.current = actorId;
    actorGenerationRef.current += 1;
  }
  const [data, setData] = useState<ActorScheduleListResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    null,
  );
  const [deleteConfirmScheduleId, setDeleteConfirmScheduleId] = useState<
    string | null
  >(null);

  useEffect(() => {
    const actorGeneration = actorGenerationRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setDrafts({});
    setSavingId(null);
    setDeletingId(null);
    setSelectedScheduleId(null);
    setDeleteConfirmScheduleId(null);
    void getActorSchedules(actorId, { signal: controller.signal })
      .then((response) => {
        if (!isCurrentActorRun(actorId, actorGeneration)) return;
        setData(response);
        setDrafts(buildScheduleDrafts(response));
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        if (!isCurrentActorRun(actorId, actorGeneration)) return;
        setError(messageFromError(loadError));
      })
      .finally(() => {
        if (isCurrentActorRun(actorId, actorGeneration)) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [actorId, reloadKey]);

  function updateDraft(id: string, patch: Partial<ScheduleDraft>) {
    setDrafts((current) => {
      const previous = current[id] ?? {
        summary: "",
        prompt: "",
        runAt: "",
        error: null,
      };
      return {
        ...current,
        [id]: {
          ...previous,
          ...patch,
        },
      };
    });
  }

  async function saveSchedule(item: ActorScheduleListItem) {
    const draft = drafts[item.id] ?? {
      summary: item.summary ?? "",
      prompt: item.prompt,
      runAt: item.runAt ?? "",
      error: null,
    };
    if (savingId !== null) return;
    if (item.type === "once" && !isValidScheduleRunAt(draft.runAt)) {
      updateDraft(item.id, {
        error: "时间必须是有效的 YYYY-MM-DD HH:mm:ss。",
      });
      return;
    }
    const actorGeneration = actorGenerationRef.current;
    setSavingId(item.id);
    updateDraft(item.id, { error: null });
    try {
      const response = await patchActorSchedule(actorId, item.id, {
        summary: draft.summary,
        prompt: draft.prompt,
        ...(item.type === "once" ? { runAt: draft.runAt } : {}),
      });
      if (!response.ok || !response.schedule) {
        throw new Error(response.error?.message ?? "保存失败。");
      }
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      setData((current) =>
        current ? replaceSchedule(current, response.schedule!) : current,
      );
      updateDraft(item.id, {
        summary: response.schedule.summary ?? "",
        prompt: response.schedule.prompt,
        runAt: response.schedule.runAt ?? "",
        error: null,
      });
    } catch (saveError) {
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      updateDraft(item.id, { error: messageFromError(saveError) });
    } finally {
      if (isCurrentActorRun(actorId, actorGeneration)) {
        setSavingId(null);
      }
    }
  }

  async function deleteSchedule(item: ActorScheduleListItem) {
    if (savingId !== null || deletingId !== null) return;
    const actorGeneration = actorGenerationRef.current;
    setDeletingId(item.id);
    updateDraft(item.id, { error: null });
    try {
      const response = await deleteActorSchedule(actorId, item.id);
      if (!response.ok) {
        throw new Error(response.error?.message ?? "删除失败。");
      }
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      setData((current) =>
        current ? removeSchedule(current, item.id) : current,
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setSelectedScheduleId(null);
      setDeleteConfirmScheduleId(null);
    } catch (deleteError) {
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      setDeleteConfirmScheduleId(null);
      updateDraft(item.id, { error: messageFromError(deleteError) });
    } finally {
      if (isCurrentActorRun(actorId, actorGeneration)) {
        setDeletingId(null);
      }
    }
  }

  function isCurrentActorRun(actorIdForRun: string, generation: number) {
    return (
      activeActorRef.current === actorIdForRun &&
      actorGenerationRef.current === generation
    );
  }

  if (loading) {
    return (
      <div className={styles.actorSideDataPanel}>
        <PanelState title="日程" message="加载中" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.actorSideDataPanel}>
        <PanelState title="日程加载失败" message={error}>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCcw aria-hidden="true" />
            重试
          </button>
        </PanelState>
      </div>
    );
  }

  const groups = getScheduleGroupsForActor(data, actorId);
  if (!groups) {
    return (
      <div className={styles.actorSideDataPanel}>
        <PanelState title="日程" message="加载中" />
      </div>
    );
  }

  const selectedSchedule = selectedScheduleId
    ? findScheduleInGroups(groups, selectedScheduleId)
    : null;
  const busyId = savingId ?? deletingId;

  return (
    <div className={styles.actorSideDataPanel}>
      {SCHEDULE_GROUPS.map((group) => {
        const items = (groups?.[group.id] ?? []).filter((item) =>
          isVisibleScheduleInGroup(group.id, item),
        );
        return (
          <section key={group.id} className={styles.actorDataGroup}>
            <div className={styles.actorDataGroupHeader}>
              <h3>{group.label}</h3>
              <span>{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className={styles.actorDataEmpty}>{group.empty}</p>
            ) : group.id === "focused" ? (
              <div className={styles.actorFocusedScheduleList}>
                {items.map((item) => (
                  <FocusedScheduleRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <div className={styles.actorDataList}>
                {items.map((item) => (
                  <ScheduleCard
                    key={item.id}
                    item={item}
                    onOpen={() => setSelectedScheduleId(item.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {selectedScheduleId ? (
        <ScheduleDetailDialog
          item={selectedSchedule}
          draft={selectedSchedule ? drafts[selectedScheduleId] : undefined}
          saving={savingId === selectedScheduleId}
          deleting={deletingId === selectedScheduleId}
          disabled={busyId !== null && busyId !== selectedScheduleId}
          deleteConfirmationVisible={
            deleteConfirmScheduleId === selectedScheduleId
          }
          onClose={() => setSelectedScheduleId(null)}
          onDraftChange={(patch) => updateDraft(selectedScheduleId, patch)}
          onSave={(item) => void saveSchedule(item)}
          onRequestDelete={() => setDeleteConfirmScheduleId(selectedScheduleId)}
          onCancelDelete={() => setDeleteConfirmScheduleId(null)}
          onConfirmDelete={(item) => void deleteSchedule(item)}
        />
      ) : null}
    </div>
  );
}

function ScheduleCard({
  item,
  onOpen,
}: {
  item: ActorScheduleListItem;
  onOpen: () => void;
}) {
  const title = formatScheduleTitle(item);
  const preview = formatSchedulePreview(item);
  const session =
    item.task === "chat" ? formatScheduleSessionLabel(item) : null;

  return (
    <button type="button" className={styles.actorScheduleCard} onClick={onOpen}>
      <span className={styles.actorScheduleCardTopline}>
        <span className={styles.actorScheduleCardBadges}>
          <ScheduleBadge tone={item.task}>
            {SCHEDULE_TASK_LABELS[item.task]}
          </ScheduleBadge>
          {session ? (
            <ScheduleBadge tone="session">{session}</ScheduleBadge>
          ) : null}
        </span>
        <strong>{formatScheduleTimeLabel(item)}</strong>
      </span>
      <span className={styles.actorScheduleCardTitle}>{title}</span>
      <span className={styles.actorScheduleCardPreview}>{preview}</span>
    </button>
  );
}

function FocusedScheduleRow({ item }: { item: ActorScheduleListItem }) {
  return (
    <div className={styles.actorFocusedScheduleRow}>
      <FocusedScheduleCell
        label="session"
        value={formatFocusedScheduleSessionLabel(item)}
      />
      <FocusedScheduleCell label="下次" value={item.nextRunAt ?? "下次未定"} />
      <FocusedScheduleCell
        label="周期"
        value={formatScheduleIntervalLabel(item.interval)}
      />
    </div>
  );
}

function FocusedScheduleCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className={styles.actorFocusedScheduleCell}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function ScheduleDetailDialog({
  item,
  draft,
  saving,
  deleting,
  disabled,
  deleteConfirmationVisible,
  onClose,
  onDraftChange,
  onSave,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  item: ActorScheduleListItem | null;
  draft?: ScheduleDraft;
  saving: boolean;
  deleting: boolean;
  disabled: boolean;
  deleteConfirmationVisible: boolean;
  onClose: () => void;
  onDraftChange: (patch: Partial<ScheduleDraft>) => void;
  onSave: (item: ActorScheduleListItem) => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: (item: ActorScheduleListItem) => void;
}) {
  useEffect(() => {
    if (!item) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const currentDraft = draft ?? {
    summary: item.summary ?? "",
    prompt: item.prompt,
    runAt: item.runAt ?? "",
    error: null,
  };
  const changed =
    currentDraft.summary !== (item.summary ?? "") ||
    currentDraft.prompt !== item.prompt ||
    (item.type === "once" && currentDraft.runAt !== (item.runAt ?? ""));
  const session =
    item.task === "chat" ? formatScheduleSessionLabel(item) : null;
  const showReadonlyDetails = hasReadonlyScheduleDetails(item);

  return (
    <>
      <div
        className={styles.actorScheduleDialogOverlay}
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className={styles.actorScheduleDialog}
          role="dialog"
          aria-modal="true"
          aria-label="日程详情"
        >
          <div className={styles.actorScheduleDialogHeader}>
            <div>
              <div className={styles.actorScheduleDialogBadges}>
                <ScheduleBadge tone={item.task}>
                  {SCHEDULE_TASK_LABELS[item.task]}
                </ScheduleBadge>
                {session ? (
                  <ScheduleBadge tone="session">{session}</ScheduleBadge>
                ) : null}
                {item.type === "every" ? (
                  <ScheduleBadge tone={item.type}>周期</ScheduleBadge>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭"
            >
              <X aria-hidden="true" />
            </button>
          </div>

          {showReadonlyDetails ? (
            <div className={styles.actorScheduleDetailGrid}>
              {item.editable && item.type === "once" ? null : (
                <DetailField
                  label="时间"
                  value={formatScheduleTimeLabel(item)}
                />
              )}
              {item.lastRunAt ? (
                <DetailField label="上次执行" value={item.lastRunAt} />
              ) : null}
            </div>
          ) : null}

          {item.editable ? (
            <div className={styles.actorDataEditor}>
              {item.type === "once" ? (
                <label>
                  <span>时间</span>
                  <input
                    value={currentDraft.runAt}
                    disabled={disabled || saving || deleting}
                    placeholder="YYYY-MM-DD HH:mm:ss"
                    onChange={(event) =>
                      onDraftChange({
                        runAt: event.currentTarget.value,
                        error: null,
                      })
                    }
                  />
                </label>
              ) : null}
              <label>
                <span>摘要</span>
                <input
                  value={currentDraft.summary}
                  disabled={disabled || saving || deleting}
                  onChange={(event) =>
                    onDraftChange({ summary: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>正文</span>
                <textarea
                  value={currentDraft.prompt}
                  disabled={disabled || saving || deleting}
                  rows={8}
                  onChange={(event) =>
                    onDraftChange({ prompt: event.currentTarget.value })
                  }
                />
              </label>
              {currentDraft.error ? (
                <p className={styles.actorDataError}>{currentDraft.error}</p>
              ) : null}
              <div className={styles.actorMemoryDetailActions}>
                <button
                  type="button"
                  disabled={!changed || disabled || saving || deleting}
                  onClick={() => onSave(item)}
                >
                  <Save aria-hidden="true" />
                  {saving ? "保存中" : "保存"}
                </button>
                <button
                  type="button"
                  className={styles.actorMemoryDeleteButton}
                  disabled={disabled || saving || deleting}
                  onClick={onRequestDelete}
                >
                  <Trash2 aria-hidden="true" />
                  {deleting ? "删除中" : "删除"}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actorScheduleReadonlyDetail}>
              <span>正文</span>
              <p>{item.prompt || item.summary || "该日程没有可编辑正文。"}</p>
            </div>
          )}
        </div>
      </div>
      {deleteConfirmationVisible ? (
        <ScheduleDeleteConfirmDialog
          item={item}
          deleting={deleting}
          onCancel={onCancelDelete}
          onConfirm={() => onConfirmDelete(item)}
        />
      ) : null}
    </>
  );
}

function ScheduleDeleteConfirmDialog({
  item,
  deleting,
  onCancel,
  onConfirm,
}: {
  item: ActorScheduleListItem;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className={`${styles.llmUnsavedOverlay} ${styles.actorDetailConfirmOverlay}`}
      role="alertdialog"
    >
      <div className={styles.llmUnsavedDialog}>
        <h4>删除日程</h4>
        <p>将删除 {formatScheduleTitle(item)}。删除后无法恢复，确认继续吗？</p>
        <div className={styles.llmUnsavedActions}>
          <button type="button" disabled={deleting} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={styles.llmUnsavedDangerButton}
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? "删除中" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleBadge({
  tone,
  children,
}: {
  tone:
    | ActorScheduleListItem["task"]
    | ActorScheduleListItem["type"]
    | "session";
  children: ReactNode;
}) {
  const className = `${styles.actorScheduleBadge} ${
    tone === "activity"
      ? styles.actorScheduleBadgeActivity
      : tone === "chat"
        ? styles.actorScheduleBadgeChat
        : tone === "once"
          ? styles.actorScheduleBadgeOnce
          : tone === "every"
            ? styles.actorScheduleBadgeEvery
            : tone === "session"
              ? styles.actorScheduleBadgeSession
              : styles.actorScheduleBadgeNeutral
  }`;
  return <span className={className}>{children}</span>;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.actorScheduleDetailField}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelState({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.actorDataState}>
      <strong>{title}</strong>
      <span>{message}</span>
      {children}
    </div>
  );
}

function buildScheduleDrafts(
  response: ActorScheduleListResponse,
): Record<string, ScheduleDraft> {
  const drafts: Record<string, ScheduleDraft> = {};
  for (const group of SCHEDULE_GROUPS) {
    for (const item of response.groups[group.id]) {
      if (!item.editable) continue;
      drafts[item.id] = {
        summary: item.summary ?? "",
        prompt: item.prompt,
        runAt: item.runAt ?? "",
        error: null,
      };
    }
  }
  return drafts;
}

function replaceSchedule(
  response: ActorScheduleListResponse,
  updated: ActorScheduleListItem,
): ActorScheduleListResponse {
  const groups = Object.fromEntries(
    SCHEDULE_GROUPS.map((group) => [
      group.id,
      response.groups[group.id].map((item) =>
        item.id === updated.id ? updated : item,
      ),
    ]),
  ) as Record<ActorScheduleGroupId, ActorScheduleListItem[]>;
  return { ...response, groups };
}

function removeSchedule(
  response: ActorScheduleListResponse,
  deletedId: string,
): ActorScheduleListResponse {
  const groups = Object.fromEntries(
    SCHEDULE_GROUPS.map((group) => [
      group.id,
      response.groups[group.id].filter((item) => item.id !== deletedId),
    ]),
  ) as Record<ActorScheduleGroupId, ActorScheduleListItem[]>;
  return { ...response, groups };
}

function findScheduleInGroups(
  groups: Record<ActorScheduleGroupId, ActorScheduleListItem[]>,
  scheduleId: string,
): ActorScheduleListItem | null {
  for (const group of SCHEDULE_GROUPS) {
    const item = groups[group.id].find(
      (candidate) => candidate.id === scheduleId,
    );
    if (item) return item;
  }
  return null;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
