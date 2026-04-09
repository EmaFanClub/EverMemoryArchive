import type { ShortTermMemoryRecord, ShortTermMemory } from "./base";
import { formatTimestamp } from "../utils";

export type ShortTermMemoryTask =
  | "activity_tick"
  | "heartbeat_activity"
  | "memory_update";

export interface ActivityTickTaskData {
  task: "activity_tick";
  triggeredAt: number;
  activityAdded?: boolean;
}

export interface HeartbeatActivityTaskData {
  task: "heartbeat_activity";
  triggeredAt: number;
  activityAdded?: boolean;
}

export interface MemoryUpdateTaskData {
  task: "memory_update";
  triggeredAt: number;
  activitySnapshot: ShortTermMemoryRecord[];
  completedActivityIds?: number[];
}

export type ShortTermMemoryTaskData =
  | ActivityTickTaskData
  | HeartbeatActivityTaskData
  | MemoryUpdateTaskData;

/**
 * Resolves structured task metadata from tool context data.
 * @param data - Unstructured tool context payload.
 * @returns Parsed task data when available and valid.
 */
export function getShortTermMemoryTaskData(
  data?: Record<string, unknown>,
): ShortTermMemoryTaskData | null {
  if (!data || typeof data.triggeredAt !== "number") {
    return null;
  }
  if (data.task === "activity_tick") {
    return {
      task: "activity_tick",
      triggeredAt: data.triggeredAt,
      ...(data.activityAdded === true ? { activityAdded: true } : {}),
    };
  }
  if (data.task === "heartbeat_activity") {
    return {
      task: "heartbeat_activity",
      triggeredAt: data.triggeredAt,
      ...(data.activityAdded === true ? { activityAdded: true } : {}),
    };
  }
  if (data.task !== "memory_update" || !Array.isArray(data.activitySnapshot)) {
    return null;
  }
  const activitySnapshot = data.activitySnapshot.filter(
    isShortTermMemoryRecord,
  );
  return {
    task: "memory_update",
    triggeredAt: data.triggeredAt,
    activitySnapshot,
    ...(Array.isArray(data.completedActivityIds)
      ? {
          completedActivityIds: data.completedActivityIds.filter(
            (item): item is number => typeof item === "number",
          ),
        }
      : {}),
  };
}

/**
 * Formats the canonical date key for a short-term memory kind.
 * @param kind - Target memory kind.
 * @param timestamp - Source timestamp in milliseconds.
 * @returns Canonical date key.
 */
export function formatShortTermMemoryDate(
  kind: ShortTermMemory["kind"],
  timestamp: number,
): string {
  switch (kind) {
    case "activity":
    case "day":
      return formatTimestamp("YYYY-MM-DD", timestamp);
    case "month":
      return formatTimestamp("YYYY-MM", timestamp);
    case "year":
      return formatTimestamp("YYYY", timestamp);
  }
}

function isShortTermMemoryRecord(
  value: unknown,
): value is ShortTermMemoryRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<ShortTermMemoryRecord>;
  return (
    typeof item.id === "number" &&
    typeof item.kind === "string" &&
    typeof item.date === "string" &&
    typeof item.memory === "string"
  );
}
