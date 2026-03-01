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
  description = "创建、查询、修改或删除提醒任务。";

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
    const actorScope = context?.actorScope;
    if (!server) {
      return {
        success: false,
        error: "Missing server in skill context.",
      };
    }
    if (!actorScope) {
      return {
        success: false,
        error: "Missing actorScope in skill context.",
      };
    }

    switch (payload.action) {
      case "create":
        return executeCreateReminder(server, actorScope, payload);
      case "list":
        return executeListReminders(server, actorScope);
      case "update":
        return executeUpdateReminder(server, actorScope, payload);
      case "delete":
        return executeDeleteReminder(server, actorScope, payload);
      default:
        return {
          success: false,
          error: "Unsupported reminder action.",
        };
    }
  }
}
