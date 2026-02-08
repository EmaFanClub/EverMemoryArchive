import { z } from "zod";
import type { ActorScope } from "../../actor";
import type { Server } from "../../server";
import { isJob } from "../../scheduler/base";
import type { ToolResult } from "../../tools/base";

export const DeleteReminderSchema = z
  .object({
    action: z.literal("delete").describe("删除提醒任务"),
    jobId: z.string().min(1).describe("要删除的任务 ID"),
  })
  .strict();

export type DeleteReminderInput = z.infer<typeof DeleteReminderSchema>;

/**
 * Deletes a reminder job owned by the current actor.
 * @param server - Server instance providing scheduling.
 * @param actorScope - Actor scope for ownership and routing.
 * @param payload - Parsed delete reminder payload.
 */
export async function executeDeleteReminder(
  server: Server,
  actorScope: ActorScope,
  payload: DeleteReminderInput,
): Promise<ToolResult> {
  const job = await server.scheduler.getJob(payload.jobId);
  if (!job || !isJob(job, "actor_foreground")) {
    return {
      success: false,
      error: "Reminder job not found.",
    };
  }

  const data = job.attrs.data;
  if (data?.ownerId !== actorScope.actorId) {
    return {
      success: false,
      error: "Reminder job does not belong to the current actor.",
    };
  }

  const removed = await server.scheduler.cancel(payload.jobId);
  return removed
    ? { success: true, content: "OK" }
    : { success: false, error: "Failed to delete reminder job." };
}
