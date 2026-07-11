"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCcw, Save, Trash2, X } from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import {
  deleteActorMemory,
  getActorMemories,
  patchActorMemory,
} from "@/transport/dashboard";
import type {
  ActorMemoryKind,
  ActorMemoryListItem,
  ActorMemoryListResponse,
} from "@/types/dashboard/v1beta1";

import {
  MEMORY_GROUPS,
  countApproxMemoryLength,
  formatMemoryPreview,
  formatMemorySourceLabel,
  formatMemoryUpdatedAtLabel,
  getMemoryGroupsForActor,
} from "./actor-schedule-memory";

interface MemoryDraft {
  memory: string;
  error: string | null;
}

export function ActorMemoryPanel({ actorId }: { actorId: string }) {
  const activeActorRef = useRef(actorId);
  const actorGenerationRef = useRef(0);
  if (activeActorRef.current !== actorId) {
    activeActorRef.current = actorId;
    actorGenerationRef.current += 1;
  }
  const [data, setData] = useState<ActorMemoryListResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MemoryDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [deleteConfirmMemoryId, setDeleteConfirmMemoryId] = useState<
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
    setSelectedMemoryId(null);
    setDeleteConfirmMemoryId(null);
    void getActorMemories(actorId, { signal: controller.signal })
      .then((response) => {
        if (!isCurrentActorRun(actorId, actorGeneration)) return;
        setData(response);
        setDrafts(buildMemoryDrafts(response));
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

  function updateDraft(id: string, patch: Partial<MemoryDraft>) {
    setDrafts((current) => {
      const previous = current[id] ?? {
        memory: "",
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

  async function saveMemory(item: ActorMemoryListItem) {
    const draft = drafts[item.id];
    if (!draft || savingId !== null) return;
    const actorGeneration = actorGenerationRef.current;
    setSavingId(item.id);
    updateDraft(item.id, { error: null });
    try {
      const response = await patchActorMemory(actorId, item.id, {
        memory: draft.memory,
      });
      if (!response.ok || !response.memory) {
        throw new Error(response.error?.message ?? "保存失败。");
      }
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      setData((current) =>
        current ? replaceMemory(current, response.memory!) : current,
      );
      updateDraft(item.id, {
        memory: response.memory.memory,
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

  async function deleteMemory(item: ActorMemoryListItem) {
    if (savingId !== null || deletingId !== null) return;
    const actorGeneration = actorGenerationRef.current;
    setDeletingId(item.id);
    updateDraft(item.id, { error: null });
    try {
      const response = await deleteActorMemory(actorId, item.id);
      if (!response.ok) {
        throw new Error(response.error?.message ?? "删除失败。");
      }
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      setData((current) =>
        current ? removeMemory(current, item.id) : current,
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setSelectedMemoryId(null);
      setDeleteConfirmMemoryId(null);
    } catch (deleteError) {
      if (!isCurrentActorRun(actorId, actorGeneration)) return;
      setDeleteConfirmMemoryId(null);
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
        <PanelState title="记忆" message="加载中" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.actorSideDataPanel}>
        <PanelState title="记忆加载失败" message={error}>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCcw aria-hidden="true" />
            重试
          </button>
        </PanelState>
      </div>
    );
  }

  const groups = getMemoryGroupsForActor(data, actorId);
  if (!groups) {
    return (
      <div className={styles.actorSideDataPanel}>
        <PanelState title="记忆" message="加载中" />
      </div>
    );
  }

  const selectedMemory = selectedMemoryId
    ? findMemoryInGroups(groups, selectedMemoryId)
    : null;
  const busyId = savingId ?? deletingId;

  return (
    <div className={styles.actorSideDataPanel}>
      {MEMORY_GROUPS.map((group) => {
        const items = groups?.[group.kind] ?? [];
        return (
          <section key={group.kind} className={styles.actorDataGroup}>
            <div className={styles.actorDataGroupHeader}>
              <h3>{group.label}</h3>
              <span>{items.length}</span>
            </div>
            {items.length === 0 ? (
              <p className={styles.actorDataEmpty}>{group.empty}</p>
            ) : (
              <div className={styles.actorDataList}>
                {items.map((item) => (
                  <MemoryCard
                    key={item.id}
                    item={item}
                    onOpen={() => setSelectedMemoryId(item.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {selectedMemoryId ? (
        <MemoryDetailDialog
          item={selectedMemory}
          draft={selectedMemory ? drafts[selectedMemoryId] : undefined}
          saving={savingId === selectedMemoryId}
          deleting={deletingId === selectedMemoryId}
          disabled={busyId !== null && busyId !== selectedMemoryId}
          deleteConfirmationVisible={deleteConfirmMemoryId === selectedMemoryId}
          onClose={() => setSelectedMemoryId(null)}
          onDraftChange={(patch) => updateDraft(selectedMemoryId, patch)}
          onSave={(item) => void saveMemory(item)}
          onRequestDelete={() => setDeleteConfirmMemoryId(selectedMemoryId)}
          onCancelDelete={() => setDeleteConfirmMemoryId(null)}
          onConfirmDelete={(item) => void deleteMemory(item)}
        />
      ) : null}
    </div>
  );
}

function MemoryCard({
  item,
  onOpen,
}: {
  item: ActorMemoryListItem;
  onOpen: () => void;
}) {
  const sourceLabel = formatMemorySourceLabel(item);

  return (
    <button type="button" className={styles.actorMemoryCard} onClick={onOpen}>
      <span className={styles.actorMemoryCardTopline}>
        <span className={styles.actorMemoryCardBadges}>
          {sourceLabel ? (
            <MemorySourceBadge>{sourceLabel}</MemorySourceBadge>
          ) : null}
        </span>
        <strong>{item.date}</strong>
      </span>
      <span className={styles.actorMemoryCardPreview}>
        {formatMemoryPreview(item)}
      </span>
      <span className={styles.actorMemoryCardFooter}>
        {formatMemoryUpdatedAtLabel(item)}
      </span>
    </button>
  );
}

function MemoryDetailDialog({
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
  item: ActorMemoryListItem | null;
  draft?: MemoryDraft;
  saving: boolean;
  deleting: boolean;
  disabled: boolean;
  deleteConfirmationVisible: boolean;
  onClose: () => void;
  onDraftChange: (patch: Partial<MemoryDraft>) => void;
  onSave: (item: ActorMemoryListItem) => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: (item: ActorMemoryListItem) => void;
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

  const currentDraft = draft ?? { memory: item.memory, error: null };
  const changed = currentDraft.memory !== item.memory;
  const memoryLength = countApproxMemoryLength(currentDraft.memory);
  const overLimit = memoryLength > item.maxLength;
  const sourceLabel = formatMemorySourceLabel(item);

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
          aria-label="记忆详情"
        >
          <div className={styles.actorScheduleDialogHeader}>
            <div className={styles.actorScheduleDialogBadges}>
              {sourceLabel ? (
                <MemorySourceBadge>{sourceLabel}</MemorySourceBadge>
              ) : null}
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

          <dl className={styles.actorMemoryDetailMeta}>
            <div>
              <dt>时间</dt>
              <dd>{item.date}</dd>
            </div>
            <div>
              <dt>更新于</dt>
              <dd>
                {formatMemoryUpdatedAtLabel(item).replace(/^更新于 /, "")}
              </dd>
            </div>
          </dl>

          <div
            className={`${styles.actorDataEditor} ${styles.actorMemoryDetailEditor}`}
          >
            <label>
              <div className={styles.actorMemoryEditorLabelRow}>
                <span>正文</span>
                <strong
                  className={
                    overLimit ? styles.actorMemoryLengthCounterOver : undefined
                  }
                >
                  约 {memoryLength}/{item.maxLength}
                </strong>
              </div>
              <textarea
                value={currentDraft.memory}
                disabled={disabled || saving || deleting}
                rows={10}
                aria-invalid={overLimit || undefined}
                onChange={(event) =>
                  onDraftChange({
                    memory: event.currentTarget.value,
                    error: null,
                  })
                }
              />
            </label>
            {overLimit ? (
              <p className={styles.actorDataError}>
                正文过长，最多约 {item.maxLength} 字。
              </p>
            ) : currentDraft.error ? (
              <p className={styles.actorDataError}>{currentDraft.error}</p>
            ) : null}
            <div className={styles.actorMemoryDetailActions}>
              <button
                type="button"
                disabled={
                  !changed ||
                  disabled ||
                  saving ||
                  deleting ||
                  overLimit ||
                  !currentDraft.memory.trim()
                }
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
        </div>
      </div>
      {deleteConfirmationVisible ? (
        <MemoryDeleteConfirmDialog
          item={item}
          deleting={deleting}
          onCancel={onCancelDelete}
          onConfirm={() => onConfirmDelete(item)}
        />
      ) : null}
    </>
  );
}

function MemoryDeleteConfirmDialog({
  item,
  deleting,
  onCancel,
  onConfirm,
}: {
  item: ActorMemoryListItem;
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
        <h4>删除记忆</h4>
        <p>将删除 {item.date} 的这条记忆。删除后无法恢复，确认继续吗？</p>
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

function MemorySourceBadge({ children }: { children: ReactNode }) {
  return (
    <span
      className={`${styles.actorScheduleBadge} ${styles.actorScheduleBadgeActivity}`}
    >
      {children}
    </span>
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

function buildMemoryDrafts(
  response: ActorMemoryListResponse,
): Record<string, MemoryDraft> {
  const drafts: Record<string, MemoryDraft> = {};
  for (const group of MEMORY_GROUPS) {
    for (const item of response.groups[group.kind]) {
      drafts[item.id] = {
        memory: item.memory,
        error: null,
      };
    }
  }
  return drafts;
}

function replaceMemory(
  response: ActorMemoryListResponse,
  updated: ActorMemoryListItem,
): ActorMemoryListResponse {
  const groups = Object.fromEntries(
    MEMORY_GROUPS.map((group) => [
      group.kind,
      response.groups[group.kind].map((item) =>
        item.id === updated.id ? updated : item,
      ),
    ]),
  ) as Record<ActorMemoryKind, ActorMemoryListItem[]>;
  return { ...response, groups };
}

function removeMemory(
  response: ActorMemoryListResponse,
  deletedId: string,
): ActorMemoryListResponse {
  const groups = Object.fromEntries(
    MEMORY_GROUPS.map((group) => [
      group.kind,
      response.groups[group.kind].filter((item) => item.id !== deletedId),
    ]),
  ) as Record<ActorMemoryKind, ActorMemoryListItem[]>;
  return { ...response, groups };
}

function findMemoryInGroups(
  groups: ActorMemoryListResponse["groups"],
  memoryId: string,
): ActorMemoryListItem | null {
  for (const group of MEMORY_GROUPS) {
    const item = groups[group.kind].find(
      (candidate) => candidate.id === memoryId,
    );
    if (item) return item;
  }
  return null;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
