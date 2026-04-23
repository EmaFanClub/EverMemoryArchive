import { z } from "zod";
import { countApproxTextLength, Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import { Logger } from "../../shared/logger";

const ROLE_BOOK_MAX_LENGTH = 300;

const UpdateRoleBookSchema = z
  .object({
    prompt: z.string().min(1).describe("角色书 markdown 文本"),
  })
  .strict();

export default class UpdateRoleBookSkill extends Skill {
  description =
    "该技能用于更新当前角色的稳定角色设定，用于 ActGuiding 中的“角色”部分。";

  parameters = UpdateRoleBookSchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "UpdateRoleBookSkill",
    level: "full",
    transport: "console",
  });

  /**
   * Updates role book markdown for the current actor.
   * @param args - Arguments containing role book markdown.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof UpdateRoleBookSchema>;
    try {
      payload = UpdateRoleBookSchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid update-role-book-skill input: ${(err as Error).message}. Use get_skill to check the required parameters and their formats.`,
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

    const actualLength = countApproxTextLength(payload.prompt);
    if (actualLength > ROLE_BOOK_MAX_LENGTH) {
      return {
        success: false,
        error: `prompt is too long: got approximately ${actualLength}, max ${ROLE_BOOK_MAX_LENGTH}.`,
      };
    }

    const roleId = await server.memoryManager.upsertRolePrompt(
      actorId,
      payload.prompt,
    );
    this.logger.debug("Updated role book:", {
      actorId,
      role: payload.prompt,
    });
    return {
      success: true,
      content: "OK",
    };
  }
}
