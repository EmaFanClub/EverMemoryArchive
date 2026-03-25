import { z } from "zod";
import type { Server } from "../../server";
import { isJob } from "../../scheduler/base";
import type { ToolResult } from "../../tools/base";
import { parseRunAt } from "./utils";

export const UpdateReminderSchema = z
  .object({
    action: z.literal("update").describe("更新提醒任务"),
    jobId: z.string().min(1).describe("要更新的任务 ID"),
    type: z.enum(["once", "every"]).describe("提醒类型"),
    runAt: z
      .string()
      .min(1)
      .optional()
      .describe('新的触发时间，格式为 "YYYY-MM-DD HH:mm:ss"'),
    interval: z
      .union([z.number().int().positive(), z.string().min(1)])
      .optional()
      .describe("新的重复周期（毫秒或 cron 字符串）"),
    prompt: z.string().min(1).optional().describe("新的提示词，必须遵循模板"),
  })
  .strict()
  .refine(
    (data) =>
      data.runAt !== undefined ||
      data.interval !== undefined ||
      data.prompt !== undefined,
    {
      message: "At least one of runAt, interval, or prompt must be provided.",
    },
  );

export type UpdateReminderInput = z.infer<typeof UpdateReminderSchema>;

/**
 * Updates a reminder job owned by the current actor.
 * @param server - Server instance providing scheduling.
 * @param actorId - Actor identifier for ownership and routing.
 * @param conversationId - Conversation identifier for routing.
 * @param payload - Parsed update reminder payload.
 */
export async function executeUpdateReminder(
  server: Server,
  actorId: number,
  conversationId: number,
  payload: UpdateReminderInput,
): Promise<ToolResult> {
  const job = await server.scheduler.getJob(payload.jobId);
  if (!job || !isJob(job, "actor_foreground")) {
    return {
      success: false,
      error: "Reminder job not found.",
    };
  }

  const data = job.attrs.data;
  if (data?.actorId !== actorId) {
    return {
      success: false,
      error: "Reminder job does not belong to the current actor.",
    };
  }

  const isEvery = Boolean(job.attrs.repeatInterval);
  if (payload.type === "every" && !isEvery) {
    return {
      success: false,
      error: "Reminder job is not a recurring task.",
    };
  }
  if (payload.type === "once" && isEvery) {
    return {
      success: false,
      error: "Reminder job is a recurring task.",
    };
  }

  let runAt = job.attrs.nextRunAt?.getTime();
  if (payload.runAt !== undefined) {
    try {
      runAt = parseRunAt(payload.runAt);
    } catch (error) {
      return {
        success: false,
        error: `Invalid runAt: ${(error as Error).message}`,
      };
    }
  }

  if (!runAt) {
    return {
      success: false,
      error: "Unable to determine reminder run time.",
    };
  }

  const prompt = payload.prompt ?? data?.prompt;
  if (!prompt) {
    return {
      success: false,
      error: "Unable to determine reminder prompt.",
    };
  }

  const interval = payload.interval ?? job.attrs.repeatInterval;
  const nextData = {
    actorId,
    conversationId,
    prompt,
  };

  if (payload.type === "every") {
    if (!interval) {
      return {
        success: false,
        error: "Unable to determine reminder interval.",
      };
    }
    const updated = await server.scheduler.rescheduleEvery(payload.jobId, {
      name: "actor_foreground",
      runAt,
      interval,
      data: nextData,
    });
    return updated
      ? { success: true, content: "OK" }
      : { success: false, error: "Failed to update reminder job." };
  }

  const updated = await server.scheduler.reschedule(payload.jobId, {
    name: "actor_foreground",
    runAt,
    data: nextData,
  });
  return updated
    ? { success: true, content: "OK" }
    : { success: false, error: "Failed to update reminder job." };
}
