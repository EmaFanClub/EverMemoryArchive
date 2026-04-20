import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import type {
  CreateScheduleInput,
  UpdateScheduleInput,
} from "../../scheduler/actor_scheduler";
import { parseTimestamp } from "../../utils";

const RUN_AT_FORMAT = "YYYY-MM-DD HH:mm:ss";
const ScheduleTaskSchema = z.enum(["chat", "activity"]);
const ScheduleAdditionSchema = z.record(z.string(), z.unknown());

const ScheduleCreateBaseSchema = z.object({
  task: ScheduleTaskSchema.describe("日程任务类型，仅支持 chat 或 activity"),
  runAt: z.string().min(1).describe(`执行时间，格式为 "${RUN_AT_FORMAT}"`),
  prompt: z.string().min(1).describe("触发该日程时要给模型的提示词"),
  conversationId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("chat 任务必填；activity 任务可省略或填 null"),
  addition: ScheduleAdditionSchema.optional().describe("附加信息对象，可选"),
});

const AddOnceScheduleSchema = ScheduleCreateBaseSchema.extend({
  type: z.literal("once").describe("一次性日程"),
})
  .strict()
  .superRefine(validateConversationConstraint);

const AddRecurringScheduleSchema = ScheduleCreateBaseSchema.extend({
  type: z.literal("every").describe("周期日程"),
  interval: z
    .union([z.number().int().positive(), z.string().min(1)])
    .describe("周期表达式，可为毫秒数或 Agenda 支持的字符串表达式"),
})
  .strict()
  .superRefine(validateConversationConstraint);

const AddSchedulesSchema = z
  .object({
    action: z.literal("add_schedules"),
    items: z
      .array(z.union([AddOnceScheduleSchema, AddRecurringScheduleSchema]))
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
      .union([z.number().int().positive(), z.string().min(1)])
      .optional()
      .describe("新的周期，仅对周期任务生效"),
    prompt: z.string().min(1).optional().describe("新的提示词"),
    conversationId: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .describe("新的 conversationId；若传 null 表示清空"),
    addition: ScheduleAdditionSchema.optional().describe("新的附加信息对象"),
  })
  .strict()
  .refine(
    (value) =>
      value.runAt !== undefined ||
      value.interval !== undefined ||
      value.prompt !== undefined ||
      value.conversationId !== undefined ||
      value.addition !== undefined,
    {
      message:
        "At least one of runAt, interval, prompt, conversationId, or addition must be provided.",
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

function validateConversationConstraint(
  value:
    | z.infer<typeof AddOnceScheduleSchema>
    | z.infer<typeof AddRecurringScheduleSchema>,
  ctx: z.RefinementCtx,
): void {
  if (value.task === "chat" && typeof value.conversationId !== "number") {
    ctx.addIssue({
      code: "custom",
      path: ["conversationId"],
      message: "conversationId is required when task is 'chat'.",
    });
  }
}

function parseRunAt(value: string): number {
  try {
    return parseTimestamp(RUN_AT_FORMAT, value);
  } catch {
    throw new Error(`runAt must be in format "${RUN_AT_FORMAT}".`);
  }
}

function toCreateScheduleInput(
  item:
    | z.infer<typeof AddOnceScheduleSchema>
    | z.infer<typeof AddRecurringScheduleSchema>,
): CreateScheduleInput {
  const base = {
    type: item.type,
    task: item.task,
    runAt: parseRunAt(item.runAt),
    prompt: item.prompt,
    conversationId: item.conversationId ?? null,
    addition: item.addition,
  };
  if (item.type === "every") {
    return {
      ...base,
      type: "every",
      interval: item.interval,
    };
  }
  return {
    ...base,
    type: "once",
  };
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
    ...(item.addition !== undefined ? { addition: item.addition } : {}),
  };
}

/**
 * Skill for managing actor schedules.
 */
export default class ScheduleSkill extends Skill {
  description = "该技能用于查询、创建、修改和删除当前的日程安排。";

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
        case "list_schedules":
          return {
            success: true,
            content: JSON.stringify(await actorScheduler.list()),
          };
        case "add_schedules":
          return {
            success: true,
            content: JSON.stringify(
              await actorScheduler.add(
                payload.items.map(toCreateScheduleInput),
              ),
            ),
          };
        case "update_schedules":
          return {
            success: true,
            content: JSON.stringify(
              await actorScheduler.update(
                payload.items.map(toUpdateScheduleInput),
              ),
            ),
          };
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
