import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import {
  isValidCronExpression,
  toModelScheduleItem,
  type CreateScheduleInput,
  type UpdateScheduleInput,
} from "../../scheduler/actor_scheduler";
import { parseTimestamp } from "../../shared/utils";

const RUN_AT_FORMAT = "YYYY-MM-DD HH:mm:ss";
const CronIntervalSchema = z
  .string()
  .min(1)
  .refine((value) => isValidCronExpression(value), {
    message: "interval must be a valid 5-field cron expression.",
  });

const MillisecondsIntervalSchema = z
  .number()
  .int()
  .positive()
  .describe("循环间隔毫秒数，必须为正整数毫秒。");

const AddChatOnceScheduleSchema = z
  .object({
    type: z.literal("once").describe("一次性日程"),
    task: z
      .literal("chat")
      .describe(
        "主动对话任务：未来会去某个 conversation 主动说话、发消息、打招呼、分享内容时使用。",
      ),
    runAt: z.string().min(1).describe(`执行时间，格式为 "${RUN_AT_FORMAT}"`),
    prompt: z
      .string()
      .min(1)
      .describe("要执行的任务内容；应描述未来要在该会话里主动做什么。"),
    conversationId: z
      .number()
      .int()
      .positive()
      .describe("要在哪个会话中执行该任务"),
  })
  .strict();

const AddChatRecurringScheduleSchema = z.union([
  z
    .object({
      type: z.literal("every").describe("周期日程"),
      task: z
        .literal("chat")
        .describe(
          "主动对话任务：未来会去某个 conversation 主动说话、发消息、打招呼、分享内容时使用。",
        ),
      interval: CronIntervalSchema.describe(
        '5 段 cron 表达式，例如 "30 7 * * *"。',
      ),
      prompt: z
        .string()
        .min(1)
        .describe("要执行的任务内容；应描述未来要在该会话里主动做什么。"),
      conversationId: z
        .number()
        .int()
        .positive()
        .describe("要在哪个会话中执行该任务"),
    })
    .strict(),
  z
    .object({
      type: z.literal("every").describe("周期日程"),
      task: z
        .literal("chat")
        .describe(
          "主动对话任务：未来会去某个 conversation 主动说话、发消息、打招呼、分享内容时使用。",
        ),
      runAt: z
        .string()
        .min(1)
        .describe(`首次执行时间，格式为 "${RUN_AT_FORMAT}"`),
      interval: MillisecondsIntervalSchema,
      prompt: z
        .string()
        .min(1)
        .describe("要执行的任务内容；应描述未来要在该会话里主动做什么。"),
      conversationId: z
        .number()
        .int()
        .positive()
        .describe("要在哪个会话中执行该任务"),
    })
    .strict(),
]);

const AddActivityOnceScheduleSchema = z
  .object({
    type: z.literal("once").describe("一次性日程"),
    task: z
      .literal("activity")
      .describe(
        "后台活动任务：只在后台自己进行思考、学习、整理、回忆、冥想等，不直接去某个 conversation 发消息时使用。",
      ),
    runAt: z.string().min(1).describe(`执行时间，格式为 "${RUN_AT_FORMAT}"`),
    prompt: z
      .string()
      .min(1)
      .describe(
        "要执行的任务内容；应描述后台活动本身，而不是去某个会话发消息。",
      ),
  })
  .strict();

const AddActivityRecurringScheduleSchema = z.union([
  z
    .object({
      type: z.literal("every").describe("周期日程"),
      task: z
        .literal("activity")
        .describe(
          "后台活动任务：只在后台自己进行思考、学习、整理、回忆、冥想等，不直接去某个 conversation 发消息时使用。",
        ),
      interval: CronIntervalSchema.describe(
        '5 段 cron 表达式，例如 "0 9 * * *"。',
      ),
      prompt: z
        .string()
        .min(1)
        .describe(
          "要执行的任务内容；应描述后台活动本身，而不是去某个会话发消息。",
        ),
    })
    .strict(),
  z
    .object({
      type: z.literal("every").describe("周期日程"),
      task: z
        .literal("activity")
        .describe(
          "后台活动任务：只在后台自己进行思考、学习、整理、回忆、冥想等，不直接去某个 conversation 发消息时使用。",
        ),
      runAt: z
        .string()
        .min(1)
        .describe(`首次执行时间，格式为 "${RUN_AT_FORMAT}"`),
      interval: MillisecondsIntervalSchema,
      prompt: z
        .string()
        .min(1)
        .describe(
          "要执行的任务内容；应描述后台活动本身，而不是去某个会话发消息。",
        ),
    })
    .strict(),
]);

const AddRoutineScheduleSchema = z
  .object({
    task: z.enum(["wake", "sleep"]).describe("作息任务类型"),
    interval: CronIntervalSchema.describe(
      '作息周期必须为 5 段 cron 表达式，例如 "30 7 * * *"。',
    ),
  })
  .strict();

const AddSchedulesSchema = z
  .object({
    action: z.literal("add_schedules"),
    items: z
      .array(
        z.union([
          AddChatOnceScheduleSchema,
          AddChatRecurringScheduleSchema,
          AddActivityOnceScheduleSchema,
          AddActivityRecurringScheduleSchema,
          AddRoutineScheduleSchema,
        ]),
      )
      .min(1),
  })
  .strict();

const UpdateScheduleItemSchema = z
  .object({
    id: z.string().min(1).describe("要更新的日程 job id"),
    runAt: z
      .string()
      .min(1)
      .optional()
      .describe(`新的执行时间，格式为 "${RUN_AT_FORMAT}"`),
    interval: z
      .union([MillisecondsIntervalSchema, CronIntervalSchema])
      .optional()
      .describe(
        "新的周期：wake/sleep 必须是 5 段 cron；chat/activity 可为 5 段 cron，或配合 runAt 一起填写的正整数毫秒数。",
      ),
    prompt: z.string().min(1).optional().describe("新的任务内容"),
    conversationId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("新的 conversationId，仅 chat 任务可用"),
  })
  .strict()
  .refine(
    (value) =>
      value.runAt !== undefined ||
      value.interval !== undefined ||
      value.prompt !== undefined ||
      value.conversationId !== undefined,
    {
      message:
        "At least one of runAt, interval, prompt, or conversationId must be provided.",
    },
  );

const UpdateSchedulesSchema = z
  .object({
    action: z.literal("update_schedules"),
    items: z.array(UpdateScheduleItemSchema).min(1),
  })
  .strict();

const DeleteSchedulesSchema = z
  .object({
    action: z.literal("delete_schedules"),
    ids: z.array(z.string().min(1)).min(1),
  })
  .strict();

const ListSchedulesSchema = z
  .object({
    action: z.literal("list_schedules"),
  })
  .strict();

const ScheduleSkillSchema = z.discriminatedUnion("action", [
  ListSchedulesSchema,
  AddSchedulesSchema,
  UpdateSchedulesSchema,
  DeleteSchedulesSchema,
]);

type ScheduleSkillInput = z.infer<typeof ScheduleSkillSchema>;

type AddScheduleItem = z.infer<typeof AddSchedulesSchema>["items"][number];

function parseRunAt(value: string): number {
  try {
    return parseTimestamp(RUN_AT_FORMAT, value);
  } catch {
    throw new Error(`runAt must be in format "${RUN_AT_FORMAT}".`);
  }
}

function toCreateScheduleInput(item: AddScheduleItem): CreateScheduleInput {
  switch (item.task) {
    case "chat":
      if (item.type === "every") {
        if ("runAt" in item && typeof item.runAt === "string") {
          return {
            type: "every",
            task: "chat",
            runAt: parseRunAt(item.runAt),
            interval: item.interval,
            prompt: item.prompt,
            conversationId: item.conversationId,
          };
        }
        const interval = item.interval as string;
        return {
          type: "every",
          task: "chat",
          interval,
          prompt: item.prompt,
          conversationId: item.conversationId,
        };
      }
      return {
        type: "once",
        task: "chat",
        runAt: parseRunAt(item.runAt),
        prompt: item.prompt,
        conversationId: item.conversationId,
      };
    case "activity":
      if (item.type === "every") {
        if ("runAt" in item && typeof item.runAt === "string") {
          return {
            type: "every",
            task: "activity",
            runAt: parseRunAt(item.runAt),
            interval: item.interval,
            prompt: item.prompt,
          };
        }
        const interval = item.interval as string;
        return {
          type: "every",
          task: "activity",
          interval,
          prompt: item.prompt,
        };
      }
      return {
        type: "once",
        task: "activity",
        runAt: parseRunAt(item.runAt),
        prompt: item.prompt,
      };
    case "wake":
    case "sleep":
      return {
        task: item.task,
        interval: item.interval,
      };
  }
}

function toUpdateScheduleInput(
  item: z.infer<typeof UpdateScheduleItemSchema>,
): UpdateScheduleInput {
  return {
    id: item.id,
    ...(item.runAt !== undefined ? { runAt: parseRunAt(item.runAt) } : {}),
    ...(item.interval !== undefined ? { interval: item.interval } : {}),
    ...(item.prompt !== undefined ? { prompt: item.prompt } : {}),
    ...(item.conversationId !== undefined
      ? { conversationId: item.conversationId }
      : {}),
  };
}

/**
 * Skill for managing actor schedules.
 */
export default class ScheduleSkill extends Skill {
  description =
    "该技能用于查询、创建、修改和删除当前的日程安排，可以调整作息、安排未来的主动对话和自主活动、调整计划等。";

  parameters = ScheduleSkillSchema.toJSONSchema();

  /**
   * Executes schedule operations for the current actor.
   * @param args - Skill arguments.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    let payload: ScheduleSkillInput;
    try {
      payload = ScheduleSkillSchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid schedule-skill input: ${(err as Error).message}`,
      };
    }

    const server = context?.server;
    const actorId = context?.actorId;
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

    const actorScheduler = server.getActorScheduler(actorId);

    try {
      switch (payload.action) {
        case "list_schedules": {
          const listed = await actorScheduler.list();
          return {
            success: true,
            content: JSON.stringify({
              overdue: listed.overdue.map(toModelScheduleItem),
              upcoming: listed.upcoming.map(toModelScheduleItem),
              recurring: listed.recurring.map(toModelScheduleItem),
            }),
          };
        }
        case "add_schedules": {
          const result = await actorScheduler.add(
            payload.items.map(toCreateScheduleInput),
          );
          return {
            success: true,
            content: JSON.stringify({
              added: result.added.map(toModelScheduleItem),
            }),
          };
        }
        case "update_schedules": {
          const result = await actorScheduler.update(
            payload.items.map(toUpdateScheduleInput),
          );
          return {
            success: true,
            content: JSON.stringify({
              updated: result.updated.map(toModelScheduleItem),
            }),
          };
        }
        case "delete_schedules":
          return {
            success: true,
            content: JSON.stringify(await actorScheduler.delete(payload.ids)),
          };
        default: {
          const unreachable: never = payload;
          return {
            success: false,
            error: `Unsupported schedule action: ${String(unreachable)}`,
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  }
}
