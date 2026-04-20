import type {
  ActorBackgroundJobData,
  ActorForegroundJobData,
} from "./jobs/actor.job";
import type { Job, JobEverySpec, JobId, JobSpec, Scheduler } from "./base";
import { formatTimestamp, parseTimestamp } from "../utils";

const RUN_AT_FORMAT = "YYYY-MM-DD HH:mm:ss";
const SCHEDULE_TASKS = new Set<ActorScheduleTask>([
  "chat",
  "activity",
  "wake",
  "sleep",
]);

/**
 * Actor-visible schedule task types.
 */
export type ActorScheduleTask = "chat" | "activity" | "wake" | "sleep";

/**
 * One-time schedule item exposed to the actor layer.
 */
export interface ActorOnceScheduleItem {
  id: JobId;
  type: "once";
  task: ActorScheduleTask;
  runAt: string;
  conversationId: number | null;
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
}

/**
 * Input for creating a one-time schedule.
 */
export interface CreateOnceScheduleInput {
  type: "once";
  task: ActorScheduleTask;
  runAt: number;
  conversationId?: number | null;
  prompt: string;
  addition?: Record<string, unknown>;
}

/**
 * Input for creating a recurring schedule.
 */
export interface CreateRecurringScheduleInput {
  type: "every";
  task: ActorScheduleTask;
  runAt: number;
  interval: string | number;
  conversationId?: number | null;
  prompt: string;
  addition?: Record<string, unknown>;
}

/**
 * Input for creating schedule items.
 */
export type CreateScheduleInput =
  | CreateOnceScheduleInput
  | CreateRecurringScheduleInput;

/**
 * Input for updating an existing schedule.
 */
export interface UpdateScheduleInput {
  id: JobId;
  runAt?: number;
  interval?: string | number;
  conversationId?: number | null;
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

    for (const job of jobs) {
      const item = this.toScheduleItem(job);
      if (!item) {
        continue;
      }
      if (item.type === "every") {
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

    return {
      overdue,
      upcoming,
      recurring,
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
      const spec = this.buildScheduleSpec(item);
      const id =
        item.type === "every"
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
      const prompt = item.prompt ?? current.prompt;
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

  private buildScheduleSpec(item: CreateScheduleInput): JobSpec | JobEverySpec {
    const conversationId = resolveConversationId(
      item.task,
      item.conversationId,
    );
    const data = buildJobData(
      this.actorId,
      item.task,
      item.prompt,
      conversationId,
      sanitizeAddition(item.addition),
    );
    if (item.type === "every") {
      return {
        name: getJobName(item.task),
        runAt: item.runAt,
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
    if (
      !data ||
      data.actorId !== this.actorId ||
      typeof data.prompt !== "string"
    ) {
      return null;
    }
    const addition = cloneAddition(data.addition);
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
        prompt: data.prompt,
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
      prompt: data.prompt,
      addition,
    };
  }
}

function buildJobData(
  actorId: number,
  task: ActorScheduleTask,
  prompt: string,
  conversationId: number | null,
  addition: Record<string, unknown>,
): ActorForegroundJobData | ActorBackgroundJobData {
  if (task === "chat") {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId is required for chat schedules.");
    }
    return {
      actorId,
      conversationId,
      task,
      prompt,
      addition,
    };
  }
  return {
    actorId,
    ...(typeof conversationId === "number" ? { conversationId } : {}),
    task,
    prompt,
    addition,
  };
}

function getJobName(
  task: ActorScheduleTask,
): "actor_foreground" | "actor_background" {
  return task === "chat" ? "actor_foreground" : "actor_background";
}

function getScheduleTask(job: Job): ActorScheduleTask | null {
  const data = job.attrs.data as
    | ActorForegroundJobData
    | ActorBackgroundJobData
    | undefined;
  const task = data?.task;
  if (job.attrs.name === "actor_foreground") {
    return task === "chat" ? "chat" : null;
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
  if (task === "chat") {
    if (typeof conversationId !== "number") {
      throw new Error("conversationId is required for chat schedules.");
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
