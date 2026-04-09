import { z } from "zod";
import { countApproxTextLength, Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import type { ShortTermMemory, ShortTermMemoryRecord } from "../../memory/base";
import {
  formatShortTermMemoryDate,
  getShortTermMemoryTaskData,
} from "../../memory/update_tasks";
import { Logger } from "../../logger";

const SHORT_TERM_MEMORY_MAX_LENGTH = {
  activity: 100,
  day: 200,
  month: 300,
  year: 400,
} as const;

const GetTasksSchema = z
  .object({
    action: z.literal("get_tasks"),
  })
  .strict();

const AddActivitySchema = z
  .object({
    action: z.literal("add_activity"),
    memory: z.string().min(1).describe("活动记录正文"),
  })
  .strict();

const UpdateMemoryActionSchema = z
  .object({
    action: z.literal("update_memory"),
    task_id: z.number().int().positive(),
    kind: z.enum(["day", "month", "year"]),
    date: z.string().min(1),
    memory: z.string().min(1),
  })
  .strict();

const UpdateMemorySchema = z
  .object({
    actions: z.array(UpdateMemoryActionSchema).min(1),
  })
  .strict();

interface PendingMemoryTask {
  taskId: number;
  sourceKind: "activity" | "day" | "month";
  sourceIds: number[];
  sourceMemory: string;
  targetKind: "day" | "month" | "year";
  targetDate: string;
  targetMemory: string;
}

export default class UpdateShortTermMemorySkill extends Skill {
  description =
    "此技能用于更新短期记忆（activity/day/month/year），仅在系统明确要求更新短期记忆时使用。";

  parameters = {
    type: "object",
    oneOf: [
      GetTasksSchema.toJSONSchema(),
      AddActivitySchema.toJSONSchema(),
      UpdateMemorySchema.toJSONSchema(),
    ],
  };

  private readonly logger: Logger = Logger.create({
    name: "UpdateShortTermMemorySkill",
    level: "full",
    transport: "console",
  });

  /**
   * Executes short-term memory task discovery or updates.
   * @param args - Skill arguments.
   * @param context - Tool context containing server and actor scope.
   * @returns Tool execution result.
   */
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    const server = context?.server;
    const actorId = context?.actorId;
    const taskData = getShortTermMemoryTaskData(context?.data);
    if (!server) {
      return {
        success: false,
        error: "Missing server in skill context.",
      };
    }
    if (!actorId) {
      return {
        success: false,
        error: "Missing actorId in skill context.",
      };
    }
    if (!taskData) {
      return {
        success: false,
        error: "Missing short-term memory task metadata in tool context.",
      };
    }

    const parsed = this.parseArgs(args);
    if (!parsed.success) {
      return parsed.result;
    }

    if (parsed.kind === "get_tasks") {
      return this.handleGetTasks(actorId, context);
    }
    if (parsed.kind === "add_activity") {
      return this.handleAddActivity(actorId, parsed.payload, context);
    }
    return this.handleUpdateMemory(actorId, parsed.payload, context);
  }

  private parseArgs(args: unknown):
    | {
        success: true;
        kind: "get_tasks";
        payload: z.infer<typeof GetTasksSchema>;
      }
    | {
        success: true;
        kind: "add_activity";
        payload: z.infer<typeof AddActivitySchema>;
      }
    | {
        success: true;
        kind: "update_memory";
        payload: z.infer<typeof UpdateMemorySchema>;
      }
    | { success: false; result: ToolResult } {
    try {
      return {
        success: true,
        kind: "get_tasks",
        payload: GetTasksSchema.parse(args ?? {}),
      };
    } catch {
      // fall through
    }
    try {
      return {
        success: true,
        kind: "add_activity",
        payload: AddActivitySchema.parse(args ?? {}),
      };
    } catch {
      // fall through
    }
    try {
      return {
        success: true,
        kind: "update_memory",
        payload: UpdateMemorySchema.parse(args ?? {}),
      };
    } catch (err) {
      return {
        success: false,
        result: {
          success: false,
          error: `Invalid update-short-term-memory-skill input: ${(err as Error).message}. Use get_skill to check the required parameters and their formats.`,
        },
      };
    }
  }

  private async handleGetTasks(
    actorId: number,
    context?: ToolContext,
  ): Promise<ToolResult> {
    const taskData = getShortTermMemoryTaskData(context?.data);
    if (!taskData) {
      return {
        success: false,
        error: "Missing short-term memory task metadata in tool context.",
      };
    }
    if (
      taskData.task === "activity_tick" ||
      taskData.task === "heartbeat_activity"
    ) {
      return {
        success: true,
        content: JSON.stringify({
          action: "add_activity",
          prompt:
            taskData.activityAdded === true
              ? "本次活动记录已经提交完成，不需要再次新增。"
              : "按照要求增加一条活动记录，如果不需要增加可直接结束。",
          has_next_tasks: false,
        }),
      };
    }

    const pendingTasks = await this.buildPendingMemoryTasks(actorId, context);
    if (pendingTasks.length === 0) {
      return {
        success: true,
        content: JSON.stringify({
          action: "update_memory",
          prompt: "当前没有需要处理的短期记忆任务。",
          has_next_tasks: false,
          tasks: [],
        }),
      };
    }
    const sourceKind = pendingTasks[0].sourceKind;
    return {
      success: true,
      content: JSON.stringify({
        action: "update_memory",
        prompt: this.getBatchPrompt(sourceKind),
        has_next_tasks: sourceKind !== "month",
        tasks: pendingTasks.map((task) => ({
          task_id: task.taskId,
          source: {
            kind: task.sourceKind,
            memory: task.sourceMemory,
          },
          target: {
            kind: task.targetKind,
            date: task.targetDate,
            memory: task.targetMemory,
          },
        })),
      }),
    };
  }

  private async handleAddActivity(
    actorId: number,
    payload: z.infer<typeof AddActivitySchema>,
    context?: ToolContext,
  ): Promise<ToolResult> {
    const taskData = getShortTermMemoryTaskData(context?.data);
    if (
      !taskData ||
      (taskData.task !== "activity_tick" &&
        taskData.task !== "heartbeat_activity")
    ) {
      return {
        success: false,
        error:
          "add_activity can only be used in activity creation tasks (activity_tick or heartbeat_activity).",
      };
    }
    if (taskData.activityAdded === true) {
      return {
        success: false,
        error: "Current activity task is already completed.",
      };
    }
    const actualLength = countApproxTextLength(payload.memory);
    if (actualLength > SHORT_TERM_MEMORY_MAX_LENGTH.activity) {
      return {
        success: false,
        error: `memory is too long for kind 'activity': got approximately ${actualLength}, max ${SHORT_TERM_MEMORY_MAX_LENGTH.activity}.`,
      };
    }

    await context!.server!.memoryManager.appendShortTermMemory(actorId, {
      kind: "activity",
      date: formatShortTermMemoryDate("activity", taskData.triggeredAt),
      memory: payload.memory,
      createdAt: taskData.triggeredAt,
      updatedAt: taskData.triggeredAt,
    });
    if (context?.data) {
      context.data.activityAdded = true;
    }
    this.logger.debug("Updated short-term memory.", payload);
    return {
      success: true,
      content: JSON.stringify({ success: true }),
    };
  }

  private async handleUpdateMemory(
    actorId: number,
    payload: z.infer<typeof UpdateMemorySchema>,
    context?: ToolContext,
  ): Promise<ToolResult> {
    const taskData = getShortTermMemoryTaskData(context?.data);
    if (!taskData || taskData.task !== "memory_update") {
      return {
        success: false,
        error:
          "update_memory can only be used in the short-term memory maintenance task.",
      };
    }
    const currentTasks = await this.buildPendingMemoryTasks(actorId, context);
    if (currentTasks.length === 0) {
      return {
        success: false,
        error: "There are no pending short-term memory tasks to submit.",
      };
    }
    if (payload.actions.length !== currentTasks.length) {
      return {
        success: false,
        error: `Expected ${currentTasks.length} update_memory actions, got ${payload.actions.length}.`,
      };
    }

    const actionMap = new Map(
      payload.actions.map((item) => [item.task_id, item]),
    );
    for (const task of currentTasks) {
      const action = actionMap.get(task.taskId);
      if (!action) {
        return {
          success: false,
          error: `Missing update_memory action for task_id ${task.taskId}.`,
        };
      }
      if (action.kind !== task.targetKind) {
        return {
          success: false,
          error: `Task ${task.taskId} must update kind '${task.targetKind}', got '${action.kind}'.`,
        };
      }
      if (action.date !== task.targetDate) {
        return {
          success: false,
          error: `Task ${task.taskId} must update date '${task.targetDate}', got '${action.date}'.`,
        };
      }
      const maxLength = SHORT_TERM_MEMORY_MAX_LENGTH[action.kind];
      const actualLength = countApproxTextLength(action.memory);
      if (actualLength > maxLength) {
        return {
          success: false,
          error: `memory is too long for kind '${action.kind}': got approximately ${actualLength}, max ${maxLength}.`,
        };
      }
    }
    if (actionMap.size !== currentTasks.length) {
      return {
        success: false,
        error: "Unexpected extra update_memory actions were provided.",
      };
    }

    for (const task of currentTasks) {
      const action = actionMap.get(task.taskId)!;
      await context!.server!.memoryManager.upsertShortTermMemory(actorId, {
        kind: task.targetKind,
        date: task.targetDate,
        memory: action.memory,
        createdAt: taskData.triggeredAt,
        updatedAt: taskData.triggeredAt,
      });
      await context!.server!.memoryManager.markShortTermMemoryRecordsProcessed(
        actorId,
        task.sourceIds,
        taskData.triggeredAt,
      );
    }

    if (context?.data && currentTasks[0]?.sourceKind === "activity") {
      const completed = new Set<number>(
        Array.isArray(context.data.completedActivityIds)
          ? (context.data.completedActivityIds as number[])
          : [],
      );
      for (const task of currentTasks) {
        for (const id of task.sourceIds) {
          completed.add(id);
        }
      }
      context.data.completedActivityIds = Array.from(completed);
    }

    this.logger.debug("Updated short-term memory.", payload);
    return {
      success: true,
      content: JSON.stringify({ success: true }),
    };
  }

  private async buildPendingMemoryTasks(
    actorId: number,
    context?: ToolContext,
  ): Promise<PendingMemoryTask[]> {
    const server = context?.server;
    const taskData = getShortTermMemoryTaskData(context?.data);
    if (!server || !taskData || taskData.task !== "memory_update") {
      return [];
    }

    const activityTasks = await this.buildActivityToDayTasks(actorId, context);
    if (activityTasks.length > 0) {
      return activityTasks;
    }

    const dayRecords = await server.memoryManager.listShortTermMemories(
      actorId,
      {
        kind: "day",
        processed: false,
        sort: "asc",
      },
    );
    const dayToMonthTasks = await this.buildRollupTasks(
      actorId,
      dayRecords,
      2,
      "day",
      "month",
      server.memoryManager,
    );
    if (dayToMonthTasks.length > 0) {
      return dayToMonthTasks;
    }

    const monthRecords = await server.memoryManager.listShortTermMemories(
      actorId,
      {
        kind: "month",
        processed: false,
        sort: "asc",
      },
    );
    return this.buildRollupTasks(
      actorId,
      monthRecords,
      2,
      "month",
      "year",
      server.memoryManager,
    );
  }

  private async buildActivityToDayTasks(
    actorId: number,
    context?: ToolContext,
  ): Promise<PendingMemoryTask[]> {
    const server = context?.server;
    const taskData = getShortTermMemoryTaskData(context?.data);
    if (!server || !taskData || taskData.task !== "memory_update") {
      return [];
    }
    const completedIds = new Set(taskData.completedActivityIds ?? []);
    const grouped = new Map<string, ShortTermMemoryRecord[]>();
    for (const item of taskData.activitySnapshot) {
      if (completedIds.has(item.id)) {
        continue;
      }
      const bucket = grouped.get(item.date) ?? [];
      bucket.push(item);
      grouped.set(item.date, bucket);
    }
    const tasks: PendingMemoryTask[] = [];
    let taskId = 1;
    for (const [date, records] of grouped) {
      const existing = await server.memoryManager.listShortTermMemories(
        actorId,
        {
          kind: "day",
          date,
          limit: 1,
        },
      );
      tasks.push({
        taskId: taskId++,
        sourceKind: "activity",
        sourceIds: records.map((item) => item.id),
        sourceMemory: records.map((item) => `- ${item.memory}`).join("\n"),
        targetKind: "day",
        targetDate: date,
        targetMemory: existing[0]?.memory ?? "",
      });
    }
    return tasks;
  }

  private async buildRollupTasks(
    actorId: number,
    records: ShortTermMemoryRecord[],
    retainLatest: number,
    sourceKind: "day" | "month",
    targetKind: "month" | "year",
    memoryManager: {
      listShortTermMemories: (
        actorId: number,
        req?: Record<string, unknown>,
      ) => Promise<ShortTermMemoryRecord[]>;
    },
  ): Promise<PendingMemoryTask[]> {
    if (records.length <= retainLatest) {
      return [];
    }
    const rollupRecords = records.slice(0, records.length - retainLatest);
    const grouped = new Map<string, ShortTermMemoryRecord[]>();
    for (const item of rollupRecords) {
      const targetDate =
        targetKind === "month" ? item.date.slice(0, 7) : item.date.slice(0, 4);
      const bucket = grouped.get(targetDate) ?? [];
      bucket.push(item);
      grouped.set(targetDate, bucket);
    }
    const tasks: PendingMemoryTask[] = [];
    let taskId = 1;
    for (const [targetDate, items] of grouped) {
      const existing = await memoryManager.listShortTermMemories(actorId, {
        kind: targetKind,
        date: targetDate,
        limit: 1,
      });
      tasks.push({
        taskId: taskId++,
        sourceKind,
        sourceIds: items.map((item) => item.id),
        sourceMemory: items
          .map((item) => `- ${item.date}：${item.memory}`)
          .join("\n\n"),
        targetKind,
        targetDate,
        targetMemory: existing[0]?.memory ?? "",
      });
    }
    return tasks;
  }

  private getBatchPrompt(sourceKind: PendingMemoryTask["sourceKind"]): string {
    switch (sourceKind) {
      case "activity":
        return "把 source 中同一天的 activity 记录整理到 target 对应日期的 day 记忆中，返回目标 day 的更新后完整版本。";
      case "day":
        return "把 source 中的所有 day 记忆整理到 target 对应月份的 month 记忆中，返回目标 month 的更新后完整版本。";
      case "month":
        return "把 source 中的所有 month 记忆整理到 target 对应年份的 year 记忆中，返回目标 year 的更新后完整版本。";
    }
  }
}
