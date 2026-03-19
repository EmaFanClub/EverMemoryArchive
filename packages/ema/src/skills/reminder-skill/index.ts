import { z } from "zod";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import { CreateReminderSchema, executeCreateReminder } from "./create";
import { ListReminderSchema, executeListReminders } from "./list";
import { UpdateReminderSchema, executeUpdateReminder } from "./update";
import { DeleteReminderSchema, executeDeleteReminder } from "./delete";

const ReminderSkillSchema = z.discriminatedUnion("action", [
  CreateReminderSchema,
  ListReminderSchema,
  UpdateReminderSchema,
  DeleteReminderSchema,
]);

export default class ReminderSkill extends Skill {
  description =
    "该技能用于创建、查询、修改或删除提醒任务。人类明确要求你在未来某个时间点提醒、重复提醒、修改提醒或查看已有提醒时使用。";

  parameters = ReminderSkillSchema.toJSONSchema();

  /**
   * Executes a reminder action for the current actor.
   * @param args - Arguments containing action and related fields.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof ReminderSkillSchema>;
    try {
      payload = ReminderSkillSchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid reminder-skill input: ${(err as Error).message}`,
      };
    }

    const server = context?.server;
    const actorId = context?.actorId;
    const conversationId = context?.conversationId;
    if (!server) {
      return {
        success: false,
        error: "Missing server in skill context.",
      };
    }
    if (!actorId || !conversationId) {
      return {
        success: false,
        error: "Missing actorId or conversationId in skill context.",
      };
    }

    switch (payload.action) {
      case "create":
        return executeCreateReminder(server, actorId, conversationId, payload);
      case "list":
        return executeListReminders(server, actorId);
      case "update":
        return executeUpdateReminder(server, actorId, conversationId, payload);
      case "delete":
        return executeDeleteReminder(server, actorId, payload);
      default:
        return {
          success: false,
          error: "Unsupported reminder action.",
        };
    }
  }
}
