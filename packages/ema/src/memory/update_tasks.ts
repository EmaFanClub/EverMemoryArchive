import type { ShortTermMemory } from "./base";

export type MemoryUpdateTask = "dialogue_tick" | "calendar_rollup";

export interface MemoryUpdateTaskData {
  task: MemoryUpdateTask;
  triggeredAt: number;
}

/**
 * Resolves which short-term memory buckets may be updated for a task.
 * @param task - Memory update task kind.
 * @param triggeredAt - Trigger timestamp in milliseconds.
 * @returns Ordered allowed update kinds.
 */
export function resolveAllowedMemoryKinds(
  task: MemoryUpdateTask,
  triggeredAt: number,
): ShortTermMemory["kind"][] {
  if (task === "dialogue_tick") {
    return ["day"];
  }
  return computeDailyRollupKinds(triggeredAt);
}

/**
 * Computes update kinds for daily rollup tasks.
 * @param timestamp - Trigger timestamp in milliseconds.
 * @returns Ordered update kinds for the current rollup.
 */
export function computeDailyRollupKinds(
  timestamp: number,
): ShortTermMemory["kind"][] {
  const date = new Date(timestamp);
  const kinds: ShortTermMemory["kind"][] = ["week"];
  if (date.getDay() === 1) {
    kinds.push("month");
  }
  if (date.getDate() === 1) {
    kinds.push("year");
  }
  return kinds;
}

/**
 * Resolves structured task metadata from tool context data.
 * @param data - Unstructured tool context payload.
 * @returns Parsed task data when available and valid.
 */
export function getMemoryUpdateTaskData(
  data?: Record<string, unknown>,
): MemoryUpdateTaskData | null {
  if (!data) {
    return null;
  }
  const task = data.task;
  const triggeredAt = data.triggeredAt;
  if (!isMemoryUpdateTask(task) || typeof triggeredAt !== "number") {
    return null;
  }
  return {
    task,
    triggeredAt,
  };
}

/**
 * Replaces the allowed-memory-kinds placeholder in a prompt template.
 * @param prompt - Prompt template text.
 * @param task - Memory update task kind.
 * @param triggeredAt - Trigger timestamp in milliseconds.
 * @returns Prompt with resolved allowed-memory-kinds text.
 */
export function injectAllowedMemoryKinds(
  prompt: string,
  task: MemoryUpdateTask,
  triggeredAt: number,
): string {
  const kinds = resolveAllowedMemoryKinds(task, triggeredAt);
  return prompt.replaceAll("{ALLOWED_MEMORY_KINDS}", kinds.join(", "));
}

function isMemoryUpdateTask(value: unknown): value is MemoryUpdateTask {
  return value === "dialogue_tick" || value === "calendar_rollup";
}
