import { z } from "zod";
import type { ActorScope } from "../../actor";
import type { Server } from "../../server";
import type { ToolResult } from "../../tools/base";
import { formatRunAt } from "./utils";

export const ListReminderSchema = z
  .object({
    action: z.literal("list").describe("列出提醒任务"),
  })
  .strict();

export type ListReminderInput = z.infer<typeof ListReminderSchema>;

/**
 * Lists reminder jobs owned by the current actor.
 * @param server - Server instance providing scheduling.
 * @param actorScope - Actor scope for ownership and routing.
 */
export async function executeListReminders(
  server: Server,
  actorScope: ActorScope,
): Promise<ToolResult> {
  const jobs = await server.scheduler.listJobs({
    name: "actor_foreground",
    "data.ownerId": actorScope.actorId,
  });

  const reminders = jobs.map((job) => {
    const runAt = job.attrs.nextRunAt?.getTime() ?? null;
    const data = job.attrs.data as { prompt?: string } | undefined;
    return {
      jobId: job.attrs._id?.toString() ?? "",
      type: job.attrs.repeatInterval ? "every" : "once",
      runAt: runAt ? formatRunAt(runAt) : null,
      interval: job.attrs.repeatInterval ?? undefined,
      prompt: data?.prompt,
    };
  });

  return {
    success: true,
    content: JSON.stringify(reminders),
  };
}
