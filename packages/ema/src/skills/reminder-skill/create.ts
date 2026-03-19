import { z } from "zod";
import type { Server } from "../../server";
import type { ToolResult } from "../../tools/base";
import { parseRunAt } from "./utils";

export const CreateReminderSchema = z
  .object({
    action: z.literal("create").describe("创建提醒任务"),
    type: z.enum(["once", "every"]).describe("提醒类型"),
    runAt: z
      .string()
      .min(1)
      .describe('提醒触发时间，格式为 "YYYY-MM-DD HH:mm:ss"'),
    interval: z
      .union([z.number().int().positive(), z.string().min(1)])
      .optional()
      .describe("重复周期（毫秒或 cron 字符串）"),
    prompt: z.string().min(1).describe("提醒时刻使用的提示词"),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === "every" && data.interval === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "interval is required when type is 'every'.",
      });
    }
    if (data.type === "once" && data.interval !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "interval must be omitted when type is 'once'.",
      });
    }
  });

export type CreateReminderInput = z.infer<typeof CreateReminderSchema>;

/**
 * Creates a reminder job for the current actor.
 * @param server - Server instance providing scheduling.
 * @param actorId - Actor identifier for ownership and routing.
 * @param conversationId - Conversation identifier for routing.
 * @param payload - Parsed create reminder payload.
 */
export async function executeCreateReminder(
  server: Server,
  actorId: number,
  conversationId: number,
  payload: CreateReminderInput,
): Promise<ToolResult> {
  const baseData = {
    actorId,
    conversationId,
    ownerId: actorId,
    prompt: payload.prompt,
  };
  let runAt: number;
  try {
    runAt = parseRunAt(payload.runAt);
  } catch (error) {
    return {
      success: false,
      error: `Invalid runAt: ${(error as Error).message}`,
    };
  }

  if (payload.type === "once") {
    await server.scheduler.schedule({
      name: "actor_foreground",
      runAt,
      data: baseData,
    });
  } else {
    await server.scheduler.scheduleEvery({
      name: "actor_foreground",
      runAt,
      interval: payload.interval!,
      data: baseData,
    });
  }

  return {
    success: true,
    content: "OK",
  };
}
