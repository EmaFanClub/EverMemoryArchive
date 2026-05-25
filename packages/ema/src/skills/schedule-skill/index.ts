import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import {
  isValidCronExpression,
  type ActorScheduleItem,
  type ActorScheduleListResult,
  type CreateScheduleInput,
  type UpdateScheduleInput,
} from "../../scheduler/actor_scheduler";
import { parseTimestamp } from "../../shared/utils";
import type { Server } from "../../server";

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

const ScheduleSummarySchema = z
  .string()
  .min(1)
  .describe("日程摘要：一条短句，用于在日程表中快速说明这件事。");

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
    summary: ScheduleSummarySchema,
    session: z.string().min(1).describe("要在哪个会话 session 中执行该任务"),
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
      summary: ScheduleSummarySchema,
      session: z.string().min(1).describe("要在哪个会话 session 中执行该任务"),
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
      summary: ScheduleSummarySchema,
      session: z.string().min(1).describe("要在哪个会话 session 中执行该任务"),
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
    summary: ScheduleSummarySchema,
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
      summary: ScheduleSummarySchema,
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
      summary: ScheduleSummarySchema,
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
    summary: ScheduleSummarySchema.optional().describe("新的日程摘要"),
    session: z
      .string()
      .min(1)
      .optional()
      .describe("新的会话 session，仅 chat 任务可用"),
  })
  .strict()
  .refine(
    (value) =>
      value.runAt !== undefined ||
      value.interval !== undefined ||
      value.prompt !== undefined ||
      value.summary !== undefined ||
      value.session !== undefined,
    {
      message:
        "At least one of runAt, interval, prompt, summary, or session must be provided.",
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

const FocusSchema = z
  .object({
    action: z.literal("focus"),
    session: z.string().min(1).describe("要关注的会话 session"),
  })
  .strict();

const ScheduleSkillSchema = z.discriminatedUnion("action", [
  ListSchedulesSchema,
  AddSchedulesSchema,
  UpdateSchedulesSchema,
  DeleteSchedulesSchema,
  FocusSchema,
]);

type ScheduleSkillInput = z.infer<typeof ScheduleSkillSchema>;

type AddScheduleItem = z.infer<typeof AddSchedulesSchema>["items"][number];
type UpdateScheduleItem = z.infer<typeof UpdateScheduleItemSchema>;

function parseRunAt(value: string): number {
  try {
    return parseTimestamp(RUN_AT_FORMAT, value);
  } catch {
    throw new Error(`runAt must be in format "${RUN_AT_FORMAT}".`);
  }
}

async function toCreateScheduleInput(
  item: AddScheduleItem,
  server: Server,
  actorId: number,
): Promise<CreateScheduleInput> {
  switch (item.task) {
    case "chat":
      const conversationId = await resolveChatConversationId(
        server,
        actorId,
        item.session,
      );
      if (item.type === "every") {
        if ("runAt" in item && typeof item.runAt === "string") {
          return {
            type: "every",
            task: "chat",
            runAt: parseRunAt(item.runAt),
            interval: item.interval,
            prompt: item.prompt,
            summary: item.summary,
            conversationId,
          };
        }
        const interval = item.interval as string;
        return {
          type: "every",
          task: "chat",
          interval,
          prompt: item.prompt,
          summary: item.summary,
          conversationId,
        };
      }
      return {
        type: "once",
        task: "chat",
        runAt: parseRunAt(item.runAt),
        prompt: item.prompt,
        summary: item.summary,
        conversationId,
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
            summary: item.summary,
          };
        }
        const interval = item.interval as string;
        return {
          type: "every",
          task: "activity",
          interval,
          prompt: item.prompt,
          summary: item.summary,
        };
      }
      return {
        type: "once",
        task: "activity",
        runAt: parseRunAt(item.runAt),
        prompt: item.prompt,
        summary: item.summary,
      };
    case "wake":
    case "sleep":
      return {
        task: item.task,
        interval: item.interval,
      };
  }
}

async function toUpdateScheduleInput(
  item: UpdateScheduleItem,
  server: Server,
  actorId: number,
): Promise<UpdateScheduleInput> {
  return {
    id: item.id,
    ...(item.runAt !== undefined ? { runAt: parseRunAt(item.runAt) } : {}),
    ...(item.interval !== undefined ? { interval: item.interval } : {}),
    ...(item.prompt !== undefined ? { prompt: item.prompt } : {}),
    ...(item.summary !== undefined ? { summary: item.summary } : {}),
    ...(item.session !== undefined
      ? {
          conversationId: await resolveChatConversationId(
            server,
            actorId,
            item.session,
          ),
        }
      : {}),
  };
}

async function resolveChatConversationId(
  server: Server,
  actorId: number,
  session: string,
): Promise<number> {
  const conversation =
    await server.dbService.conversationDB.getConversationByActorAndSession(
      actorId,
      session,
    );
  if (!conversation || typeof conversation.id !== "number") {
    throw new Error(`Conversation session ${session} not found.`);
  }
  if (conversation.allowProactive !== true) {
    throw new Error(
      `Conversation session ${session} does not allow proactive chat.`,
    );
  }
  return conversation.id;
}

async function buildScheduleSessionMap(
  items: ActorScheduleItem[],
  server: Server,
): Promise<Map<number, string>> {
  const conversationIds = new Set<number>();
  for (const item of items) {
    if (
      (item.task === "chat" || item.task === "focus") &&
      typeof item.conversationId === "number"
    ) {
      conversationIds.add(item.conversationId);
    }
  }
  const entries = await Promise.all(
    [...conversationIds].map(async (conversationId) => {
      const conversation =
        await server.dbService.conversationDB.getConversation(conversationId);
      return [conversationId, conversation?.session] as const;
    }),
  );
  return new Map(
    entries
      .filter(
        (entry): entry is readonly [number, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      )
      .map(([conversationId, session]) => [conversationId, session]),
  );
}

async function serializeScheduleItems(
  items: ActorScheduleItem[],
  server: Server,
): Promise<Record<string, unknown>[]> {
  const sessions = await buildScheduleSessionMap(items, server);
  return items.map((item) => toSkillScheduleItem(item, sessions));
}

async function serializeScheduleList(
  listed: ActorScheduleListResult,
  server: Server,
): Promise<{
  overdue: Record<string, unknown>[];
  upcoming: Record<string, unknown>[];
  recurring: Record<string, unknown>[];
  focused: Record<string, unknown>[];
}> {
  const allItems = [
    ...listed.overdue,
    ...listed.upcoming,
    ...listed.recurring,
    ...listed.focused,
  ];
  const sessions = await buildScheduleSessionMap(allItems, server);
  return {
    overdue: listed.overdue.map((item) => toSkillScheduleItem(item, sessions)),
    upcoming: listed.upcoming.map((item) =>
      toSkillScheduleItem(item, sessions),
    ),
    recurring: listed.recurring.map((item) =>
      toSkillScheduleItem(item, sessions),
    ),
    focused: listed.focused.map((item) => toSkillScheduleItem(item, sessions)),
  };
}

function toSkillScheduleItem(
  item: ActorScheduleItem,
  sessions: Map<number, string>,
): Record<string, unknown> {
  const base = {
    id: item.id,
    type: item.type,
    task: item.task,
  } satisfies Record<string, unknown>;
  const session =
    typeof item.conversationId === "number"
      ? sessions.get(item.conversationId)
      : undefined;

  if (item.type === "once") {
    if (item.task === "chat") {
      return {
        ...base,
        runAt: item.runAt,
        ...(session ? { session } : {}),
        summary: item.summary,
        prompt: item.prompt,
      };
    }
    if (item.task === "activity") {
      return {
        ...base,
        runAt: item.runAt,
        summary: item.summary,
        prompt: item.prompt,
      };
    }
    return {
      ...base,
      runAt: item.runAt,
    };
  }

  if (item.task === "chat") {
    return {
      ...base,
      nextRunAt: item.nextRunAt,
      lastRunAt: item.lastRunAt,
      interval: item.interval,
      ...(session ? { session } : {}),
      summary: item.summary,
      prompt: item.prompt,
    };
  }
  if (item.task === "focus") {
    return {
      ...base,
      nextRunAt: item.nextRunAt,
      lastRunAt: item.lastRunAt,
      interval: item.interval,
      ...(session ? { session } : {}),
    };
  }
  if (item.task === "activity") {
    return {
      ...base,
      nextRunAt: item.nextRunAt,
      lastRunAt: item.lastRunAt,
      interval: item.interval,
      summary: item.summary,
      prompt: item.prompt,
    };
  }
  return {
    ...base,
    nextRunAt: item.nextRunAt,
    lastRunAt: item.lastRunAt,
    interval: item.interval,
  };
}

/**
 * Skill for managing actor schedules.
 */
export default class ScheduleSkill extends Skill {
  description =
    "用于查询、创建、修改和删除当前的日程安排，包括提醒、主动对话、自主活动、记忆沉淀与作息维护等日程项。";

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
        content: `Invalid schedule-skill input: ${(err as Error).message}`,
      };
    }

    const server = context?.server;
    const actorId = context?.actorId;
    if (!server) {
      return {
        success: false,
        content: "Missing server in skill context.",
      };
    }
    if (!actorId) {
      return {
        success: false,
        content: "Missing actorId in skill context.",
      };
    }

    const actorScheduler = server.getActorScheduler(actorId);

    try {
      switch (payload.action) {
        case "list_schedules": {
          const listed = await actorScheduler.list();
          return {
            success: true,
            content: JSON.stringify(
              await serializeScheduleList(listed, server),
            ),
          };
        }
        case "focus": {
          const conversationId = await resolveChatConversationId(
            server,
            actorId,
            payload.session,
          );
          const result = await actorScheduler.add([
            {
              task: "focus",
              conversationId,
            },
          ]);
          return {
            success: true,
            content: JSON.stringify({
              focused: await serializeScheduleItems(result.added, server),
            }),
          };
        }
        case "add_schedules": {
          const items = await Promise.all(
            payload.items.map((item) =>
              toCreateScheduleInput(item, server, actorId),
            ),
          );
          const result = await actorScheduler.add(items);
          return {
            success: true,
            content: JSON.stringify({
              added: await serializeScheduleItems(result.added, server),
            }),
          };
        }
        case "update_schedules": {
          const items = await Promise.all(
            payload.items.map((item) =>
              toUpdateScheduleInput(item, server, actorId),
            ),
          );
          const result = await actorScheduler.update(items);
          return {
            success: true,
            content: JSON.stringify({
              updated: await serializeScheduleItems(result.updated, server),
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
            content: `Unsupported schedule action: ${String(unreachable)}`,
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        content: (err as Error).message,
      };
    }
  }
}
