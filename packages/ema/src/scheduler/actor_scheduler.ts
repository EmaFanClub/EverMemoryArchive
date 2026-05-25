import type {
  ActorBackgroundJobData,
  ActorForegroundJobData,
} from "./jobs/actor.job";
import type { Job, JobEverySpec, JobId, JobSpec, Scheduler } from "./base";
import cronParser from "cron-parser";
import { formatTimestamp, parseTimestamp } from "../shared/utils";

const RUN_AT_FORMAT = "YYYY-MM-DD HH:mm:ss";
const SCHEDULE_TASKS = new Set<ActorScheduleTask>([
  "chat",
  "activity",
  "wake",
  "sleep",
  "focus",
]);
const FOCUS_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Actor-visible schedule task types.
 */
export type ActorScheduleTask =
  | "chat"
  | "activity"
  | "wake"
  | "sleep"
  | "focus";

/**
 * One-time schedule item exposed to the actor layer.
 */
export interface ActorOnceScheduleItem {
  id: JobId;
  type: "once";
  task: ActorScheduleTask;
  runAt: string;
  conversationId: number | null;
  summary?: string;
  prompt: string;
  addition: Record<string, unknown>;
}

/**
 * Recurring schedule item exposed to the actor layer.
 */
export interface ActorRecurringScheduleItem {
  id: JobId;
  type: "every";
  task: ActorScheduleTask;
  nextRunAt: string | null;
  interval: string | number;
  lastRunAt: string | null;
  conversationId: number | null;
  summary?: string;
  prompt: string;
  addition: Record<string, unknown>;
}

/**
 * Schedule item union.
 */
export type ActorScheduleItem =
  | ActorOnceScheduleItem
  | ActorRecurringScheduleItem;

/**
 * Categorized schedule list for prompt/tool consumption.
 */
export interface ActorScheduleListResult {
  overdue: ActorOnceScheduleItem[];
  upcoming: ActorOnceScheduleItem[];
  recurring: ActorRecurringScheduleItem[];
  focused: ActorRecurringScheduleItem[];
}

interface CreateChatOnceScheduleInput {
  type: "once";
  task: "chat";
  runAt: number;
  conversationId: number;
  summary?: string;
  prompt: string;
  addition?: Record<string, unknown>;
}

interface CreateChatRecurringScheduleInput {
  type: "every";
  task: "chat";
  interval: string;
  conversationId: number;
  summary?: string;
  prompt: string;
  addition?: Record<string, unknown>;
}

interface CreateChatRecurringNumericScheduleInput {
  type: "every";
  task: "chat";
  runAt: number;
  interval: number;
  conversationId: number;
  summary?: string;
  prompt: string;
  addition?: Record<string, unknown>;
}

interface CreateActivityOnceScheduleInput {
  type: "once";
  task: "activity";
  runAt: number;
  summary?: string;
  prompt: string;
  addition?: Record<string, unknown>;
}

interface CreateActivityRecurringScheduleInput {
  type: "every";
  task: "activity";
  interval: string;
  summary?: string;
  prompt: string;
  addition?: Record<string, unknown>;
}

interface CreateActivityRecurringNumericScheduleInput {
  type: "every";
  task: "activity";
  runAt: number;
  interval: number;
  summary?: string;
  prompt: string;
  addition?: Record<string, unknown>;
}

interface CreateRoutineScheduleInput {
  task: "wake" | "sleep";
  interval: string | number;
  addition?: Record<string, unknown>;
}

interface CreateFocusScheduleInput {
  task: "focus";
  conversationId: number;
  addition?: Record<string, unknown>;
}

/**
 * Input for creating schedule items.
 */
export type CreateScheduleInput =
  | CreateChatOnceScheduleInput
  | CreateChatRecurringScheduleInput
  | CreateChatRecurringNumericScheduleInput
  | CreateActivityOnceScheduleInput
  | CreateActivityRecurringScheduleInput
  | CreateActivityRecurringNumericScheduleInput
  | CreateRoutineScheduleInput
  | CreateFocusScheduleInput;

/**
 * Input for updating an existing schedule.
 */
export interface UpdateScheduleInput {
  id: JobId;
  runAt?: number;
  interval?: string | number;
  conversationId?: number | null;
  summary?: string;
  prompt?: string;
  addition?: Record<string, unknown>;
}

/**
 * Actor-scoped wrapper around the shared scheduler.
 */
export class ActorScheduler {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly actorId: number,
  ) {}

  /**
   * Lists actor-owned schedules grouped by their current visibility.
   * @param now - Reference timestamp for grouping items.
   * @returns Categorized schedule items.
   */
  async list(now: number = Date.now()): Promise<ActorScheduleListResult> {
    const jobs = await this.scheduler.listJobs({
      "data.actorId": this.actorId,
    });
    const overdue: ActorOnceScheduleItem[] = [];
    const upcoming: ActorOnceScheduleItem[] = [];
    const recurring: ActorRecurringScheduleItem[] = [];
    const focused: ActorRecurringScheduleItem[] = [];

    for (const job of jobs) {
      const item = this.toScheduleItem(job);
      if (!item) {
        continue;
      }
      if (item.type === "every") {
        if (item.task === "focus") {
          focused.push(item);
          continue;
        }
        recurring.push(item);
        continue;
      }
      if (item.addition.overdue === true) {
        overdue.push(item);
        continue;
      }
      if (parseScheduleTime(item.runAt) >= now) {
        upcoming.push(item);
      }
    }

    overdue.sort((left, right) => left.runAt.localeCompare(right.runAt));
    upcoming.sort((left, right) => left.runAt.localeCompare(right.runAt));
    recurring.sort((left, right) => {
      const leftRunAt = left.nextRunAt ?? "";
      const rightRunAt = right.nextRunAt ?? "";
      return leftRunAt.localeCompare(rightRunAt);
    });
    focused.sort((left, right) => {
      const leftRunAt = left.nextRunAt ?? "";
      const rightRunAt = right.nextRunAt ?? "";
      return leftRunAt.localeCompare(rightRunAt);
    });

    return {
      overdue,
      upcoming,
      recurring,
      focused,
    };
  }

  /**
   * Adds schedule items for the current actor.
   * @param items - Schedule items to create.
   * @returns Created schedule items.
   */
  async add(
    items: CreateScheduleInput[],
  ): Promise<{ added: ActorScheduleItem[] }> {
    const added: ActorScheduleItem[] = [];
    for (const item of items) {
      validateCreateScheduleInput(item);
      const spec = this.buildScheduleSpec(item);
      const id = isRoutineCreateInput(item)
        ? await this.upsertRecurringRoutineSchedule(
            item.task,
            spec as JobEverySpec,
          )
        : isFocusCreateInput(item)
          ? await this.upsertRecurringFocusSchedule(
              item.conversationId,
              spec as JobEverySpec,
            )
          : item.type === "every"
            ? await this.scheduler.scheduleEvery(spec as JobEverySpec)
            : await this.scheduler.schedule(spec as JobSpec);
      added.push(await this.getOwnedScheduleItem(id));
    }
    return { added };
  }

  /**
   * Updates existing actor-owned schedule items.
   * @param items - Patch payloads keyed by job id.
   * @returns Updated schedule items.
   */
  async update(
    items: UpdateScheduleInput[],
  ): Promise<{ updated: ActorScheduleItem[] }> {
    const updated: ActorScheduleItem[] = [];
    for (const item of items) {
      const current = await this.getOwnedScheduleItem(item.id);
      validateUpdateScheduleInput(current, item);

      if (current.task === "focus") {
        throw new Error("focus schedules do not support updates.");
      }

      if (isRoutineTask(current.task)) {
        if (current.type !== "every") {
          throw new Error(`${current.task} schedules must be recurring.`);
        }
        if (
          item.runAt !== undefined ||
          item.prompt !== undefined ||
          item.conversationId !== undefined ||
          item.summary !== undefined
        ) {
          throw new Error(
            `${current.task} schedules only support interval updates.`,
          );
        }
        if (item.interval === undefined) {
          throw new Error(
            `${current.task} schedules require a new interval when updating.`,
          );
        }
        const nextRunAt =
          current.nextRunAt !== null
            ? parseScheduleTime(current.nextRunAt)
            : Date.now();
        const updatedOk = await this.scheduler.rescheduleEvery(item.id, {
          name: getJobName(current.task),
          runAt: nextRunAt,
          interval: item.interval,
          data: buildJobData(
            this.actorId,
            current.task,
            "",
            null,
            undefined,
            sanitizeAddition(item.addition ?? current.addition),
          ),
        });
        if (!updatedOk) {
          throw new Error(`Failed to update schedule ${item.id}.`);
        }
        const job = await this.scheduler.getJob(item.id);
        if (!job) {
          throw new Error(`Schedule ${item.id} not found after update.`);
        }
        job.enable();
        await job.save();
        updated.push(await this.getOwnedScheduleItem(item.id));
        continue;
      }

      const prompt = item.prompt ?? current.prompt;
      const summary = item.summary ?? current.summary;
      const conversationId = resolveConversationId(
        current.task,
        item.conversationId !== undefined
          ? item.conversationId
          : current.conversationId,
      );

      if (current.type === "every") {
        const addition = sanitizeAddition(
          item.addition ?? current.addition,
          current.addition.overdue === true,
        );
        const interval = item.interval ?? current.interval;
        const nextRunAt =
          item.runAt ??
          (current.nextRunAt ? parseScheduleTime(current.nextRunAt) : null);
        if (nextRunAt === null) {
          throw new Error(
            `Unable to determine recurring runAt for job ${item.id}.`,
          );
        }
        const updatedOk = await this.scheduler.rescheduleEvery(item.id, {
          name: getJobName(current.task),
          runAt: nextRunAt,
          interval,
          data: buildJobData(
            this.actorId,
            current.task,
            prompt,
            conversationId,
            summary,
            addition,
          ),
        });
        if (!updatedOk) {
          throw new Error(`Failed to update schedule ${item.id}.`);
        }
      } else {
        const runAt = item.runAt ?? parseScheduleTime(current.runAt);
        const shouldRemainOverdue =
          current.addition.overdue === true &&
          (item.runAt === undefined || runAt <= Date.now());
        const addition = shouldRemainOverdue
          ? markOverdue(item.addition ?? current.addition)
          : sanitizeAddition(
              item.addition ?? current.addition,
              current.addition.overdue === true,
            );
        const updatedOk = await this.scheduler.reschedule(item.id, {
          name: getJobName(current.task),
          runAt,
          data: buildJobData(
            this.actorId,
            current.task,
            prompt,
            conversationId,
            summary,
            addition,
          ),
        });
        if (!updatedOk) {
          throw new Error(`Failed to update schedule ${item.id}.`);
        }

        const job = await this.scheduler.getJob(item.id);
        if (!job) {
          throw new Error(`Schedule ${item.id} not found after update.`);
        }
        if (shouldRemainOverdue) {
          job.disable();
        } else {
          job.enable();
        }
        await job.save();
        updated.push(await this.getOwnedScheduleItem(item.id));
        continue;
      }

      const job = await this.scheduler.getJob(item.id);
      if (!job) {
        throw new Error(`Schedule ${item.id} not found after update.`);
      }
      job.enable();
      await job.save();
      updated.push(await this.getOwnedScheduleItem(item.id));
    }
    return { updated };
  }

  /**
   * Deletes actor-owned schedule items.
   * @param ids - Schedule job ids to delete.
   * @returns Deleted ids.
   */
  async delete(ids: JobId[]): Promise<{ deletedIds: JobId[] }> {
    const deletedIds: JobId[] = [];
    for (const id of ids) {
      await this.getOwnedScheduleItem(id);
      const removed = await this.scheduler.cancel(id);
      if (!removed) {
        throw new Error(`Failed to delete schedule ${id}.`);
      }
      deletedIds.push(id);
    }
    return { deletedIds };
  }

  private async getOwnedScheduleItem(id: JobId): Promise<ActorScheduleItem> {
    const job = await this.scheduler.getJob(id);
    const item = this.toScheduleItem(job);
    if (!item) {
      throw new Error(`Schedule ${id} not found.`);
    }
    return item;
  }

  private async upsertRecurringRoutineSchedule(
    task: Extract<ActorScheduleTask, "wake" | "sleep">,
    spec: JobEverySpec,
  ): Promise<JobId> {
    const jobs = await this.scheduler.listJobs({
      "data.actorId": this.actorId,
      "data.task": task,
    });
    const existing = jobs.find((job) =>
      Boolean(job.attrs.repeatInterval || job.attrs.repeatAt),
    );
    if (!existing) {
      return this.scheduler.scheduleEvery(spec);
    }
    const id = existing.attrs._id?.toString();
    if (!id) {
      throw new Error(`Recurring ${task} schedule is missing id.`);
    }
    const updated = await this.scheduler.rescheduleEvery(id, spec);
    if (!updated) {
      throw new Error(`Failed to update recurring ${task} schedule ${id}.`);
    }
    const job = await this.scheduler.getJob(id);
    if (job) {
      job.enable();
      await job.save();
    }
    return id;
  }

  private async upsertRecurringFocusSchedule(
    conversationId: number,
    spec: JobEverySpec,
  ): Promise<JobId> {
    const jobs = await this.scheduler.listJobs({
      "data.actorId": this.actorId,
      "data.task": "focus",
      "data.conversationId": conversationId,
    });
    const existing = jobs.find((job) =>
      Boolean(job.attrs.repeatInterval || job.attrs.repeatAt),
    );
    if (!existing) {
      return this.scheduler.scheduleEvery(spec);
    }
    const id = existing.attrs._id?.toString();
    if (!id) {
      throw new Error("Recurring focus schedule is missing id.");
    }
    const updated = await this.scheduler.rescheduleEvery(id, spec);
    if (!updated) {
      throw new Error(`Failed to update recurring focus schedule ${id}.`);
    }
    const job = await this.scheduler.getJob(id);
    if (job) {
      job.enable();
      await job.save();
    }
    return id;
  }

  private buildScheduleSpec(item: CreateScheduleInput): JobSpec | JobEverySpec {
    if (isRoutineCreateInput(item)) {
      return {
        name: getJobName(item.task),
        runAt: Date.now(),
        interval: item.interval,
        data: buildJobData(
          this.actorId,
          item.task,
          "",
          null,
          undefined,
          sanitizeAddition(item.addition),
        ),
      };
    }
    if (isFocusCreateInput(item)) {
      return {
        name: getJobName(item.task),
        runAt: Date.now() + FOCUS_INTERVAL_MS,
        interval: FOCUS_INTERVAL_MS,
        data: buildJobData(
          this.actorId,
          item.task,
          "",
          item.conversationId,
          undefined,
          sanitizeAddition(item.addition),
        ),
      };
    }

    const conversationId = resolveConversationId(
      item.task,
      "conversationId" in item ? item.conversationId : null,
    );
    const data = buildJobData(
      this.actorId,
      item.task,
      item.prompt,
      conversationId,
      item.summary,
      sanitizeAddition(item.addition),
    );
    if (item.type === "every") {
      return {
        name: getJobName(item.task),
        runAt: "runAt" in item ? item.runAt : Date.now(),
        interval: item.interval,
        data,
      };
    }
    return {
      name: getJobName(item.task),
      runAt: item.runAt,
      data,
    };
  }

  private toScheduleItem(job: Job | null): ActorScheduleItem | null {
    if (!job) {
      return null;
    }
    const id = job.attrs._id?.toString();
    if (!id) {
      return null;
    }
    const task = getScheduleTask(job);
    if (!task) {
      return null;
    }
    const data = job.attrs.data as
      | ActorForegroundJobData
      | ActorBackgroundJobData
      | undefined;
    if (!data || data.actorId !== this.actorId) {
      return null;
    }
    const prompt =
      typeof data.prompt === "string"
        ? data.prompt
        : isRoutineTask(task)
          ? ""
          : null;
    if (prompt === null) {
      return null;
    }
    const addition = cloneAddition(data.addition);
    const summary =
      typeof data.summary === "string" && data.summary.trim().length > 0
        ? data.summary.trim()
        : undefined;
    const conversationId =
      typeof data.conversationId === "number" ? data.conversationId : null;
    if (job.attrs.repeatInterval || job.attrs.repeatAt) {
      const interval = job.attrs.repeatInterval ?? job.attrs.repeatAt;
      if (interval === undefined) {
        return null;
      }
      return {
        id,
        type: "every",
        task,
        nextRunAt: formatScheduleTime(job.attrs.nextRunAt),
        interval,
        lastRunAt: formatScheduleTime(job.attrs.lastRunAt),
        conversationId,
        summary,
        prompt,
        addition,
      };
    }
    const runAt = formatScheduleTime(job.attrs.nextRunAt);
    if (!runAt) {
      return null;
    }
    return {
      id,
      type: "once",
      task,
      runAt,
      conversationId,
      summary,
      prompt,
      addition,
    };
  }
}

function buildJobData(
  actorId: number,
  task: ActorScheduleTask,
  prompt: string,
  conversationId: number | null,
  summary: string | undefined,
  addition: Record<string, unknown>,
): ActorForegroundJobData | ActorBackgroundJobData {
  const normalizedSummary = normalizeSummary(summary);
  if (task === "chat" || task === "focus") {
    if (typeof conversationId !== "number") {
      throw new Error(`conversationId is required for ${task} schedules.`);
    }
    return {
      actorId,
      conversationId,
      task,
      prompt,
      ...(normalizedSummary ? { summary: normalizedSummary } : {}),
      addition,
    };
  }
  if (isRoutineTask(task)) {
    return {
      actorId,
      task,
      addition,
    };
  }
  return {
    actorId,
    ...(typeof conversationId === "number" ? { conversationId } : {}),
    task,
    prompt,
    ...(normalizedSummary ? { summary: normalizedSummary } : {}),
    addition,
  };
}

function normalizeSummary(summary: string | undefined): string | undefined {
  const normalized = summary?.trim();
  return normalized ? normalized : undefined;
}

function isRoutineCreateInput(
  item: CreateScheduleInput,
): item is CreateRoutineScheduleInput {
  return item.task === "wake" || item.task === "sleep";
}

function isFocusCreateInput(
  item: CreateScheduleInput,
): item is CreateFocusScheduleInput {
  return item.task === "focus";
}

function isRoutineTask(
  task: ActorScheduleTask,
): task is Extract<ActorScheduleTask, "wake" | "sleep"> {
  return task === "wake" || task === "sleep";
}

function getJobName(
  task: ActorScheduleTask,
): "actor_foreground" | "actor_background" {
  return task === "chat" || task === "focus"
    ? "actor_foreground"
    : "actor_background";
}

function getScheduleTask(job: Job): ActorScheduleTask | null {
  const data = job.attrs.data as
    | ActorForegroundJobData
    | ActorBackgroundJobData
    | undefined;
  const task = data?.task;
  if (job.attrs.name === "actor_foreground") {
    return task === "chat" || task === "focus" ? task : null;
  }
  if (job.attrs.name !== "actor_background") {
    return null;
  }
  return typeof task === "string" &&
    SCHEDULE_TASKS.has(task as ActorScheduleTask)
    ? (task as ActorScheduleTask)
    : null;
}

function resolveConversationId(
  task: ActorScheduleTask,
  conversationId: number | null | undefined,
): number | null {
  if (task === "chat" || task === "focus") {
    if (typeof conversationId !== "number") {
      throw new Error(`conversationId is required for ${task} schedules.`);
    }
    return conversationId;
  }
  return typeof conversationId === "number" ? conversationId : null;
}

function sanitizeAddition(
  addition?: Record<string, unknown>,
  clearOverdue: boolean = false,
): Record<string, unknown> {
  const next = cloneAddition(addition);
  if (clearOverdue || next.overdue === true) {
    delete next.overdue;
  }
  return next;
}

function markOverdue(
  addition?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...cloneAddition(addition),
    overdue: true,
  };
}

function cloneAddition(
  addition?: Record<string, unknown>,
): Record<string, unknown> {
  return addition && typeof addition === "object" && !Array.isArray(addition)
    ? { ...addition }
    : {};
}

function validateCreateScheduleInput(item: CreateScheduleInput): void {
  if (isRoutineCreateInput(item)) {
    assertCronInterval(item.interval, `${item.task} schedules`);
    return;
  }
  if (isFocusCreateInput(item)) {
    return;
  }
  if (item.type !== "every") {
    return;
  }
  assertRecurringIntervalConfig(
    item.task,
    item.interval,
    "runAt" in item ? item.runAt : undefined,
  );
}

function validateUpdateScheduleInput(
  current: ActorScheduleItem,
  item: UpdateScheduleInput,
): void {
  if (current.type !== "every") {
    if (item.interval !== undefined) {
      throw new Error("once schedules do not support interval updates.");
    }
    return;
  }
  if (current.task === "focus") {
    return;
  }
  if (isRoutineTask(current.task)) {
    if (item.interval !== undefined) {
      assertCronInterval(item.interval, `${current.task} schedules`);
    }
    return;
  }
  const nextInterval = item.interval ?? current.interval;
  assertRecurringIntervalConfig(
    current.task,
    nextInterval,
    item.runAt,
    item.interval !== undefined,
  );
}

function assertRecurringIntervalConfig(
  task: "chat" | "activity",
  interval: string | number,
  runAt?: number,
  intervalWasUpdated: boolean = true,
): void {
  if (typeof interval === "string") {
    assertCronInterval(interval, `${task} recurring schedules`);
    if (runAt !== undefined) {
      throw new Error(
        `${task} recurring schedules using cron interval must not provide runAt.`,
      );
    }
    return;
  }
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error(
      `${task} recurring schedules with numeric interval require a positive interval in milliseconds.`,
    );
  }
  if (intervalWasUpdated && runAt === undefined) {
    throw new Error(
      `${task} recurring schedules with numeric interval require runAt.`,
    );
  }
}

function assertCronInterval(
  interval: string | number,
  label: string,
): asserts interval is string {
  if (typeof interval !== "string" || !isValidCronExpression(interval)) {
    throw new Error(
      `${label} require a valid 5-field cron expression for interval.`,
    );
  }
}

export function isValidCronExpression(value: string): boolean {
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }
  try {
    cronParser
      .parseExpression(value, { currentDate: new Date() })
      .next()
      .toDate();
    return true;
  } catch {
    return false;
  }
}

function formatScheduleTime(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return formatTimestamp(RUN_AT_FORMAT, value.getTime());
}

function parseScheduleTime(value: string): number {
  try {
    return parseTimestamp(RUN_AT_FORMAT, value);
  } catch {
    throw new Error(`Invalid schedule time: ${value}.`);
  }
}
