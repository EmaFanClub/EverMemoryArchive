import { z } from "zod";
import { countApproxTextLength, Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import { Logger } from "../../logger";

const PERSONALITY_MAX_LENGTH = 300;

const UpdatePersonalitySchema = z
  .object({
    memory: z.string().min(1).describe("人格记忆 markdown 文本"),
  })
  .strict();

export default class UpdatePersonalitySkill extends Skill {
  description =
    "该技能用于更新当前角色的第一人称人格自述，用于 ActGuiding 中的“人格”部分。";

  parameters = UpdatePersonalitySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "UpdatePersonalitySkill",
    level: "full",
    transport: "console",
  });

  /**
   * Updates personality memory markdown for the current actor.
   * @param args - Arguments containing personality memory markdown.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof UpdatePersonalitySchema>;
    try {
      payload = UpdatePersonalitySchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid update-personality-skill input: ${(err as Error).message}. Use get_skill to check the required parameters and their formats.`,
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

    const actualLength = countApproxTextLength(payload.memory);
    if (actualLength > PERSONALITY_MAX_LENGTH) {
      return {
        success: false,
        error: `memory is too long: got approximately ${actualLength}, max ${PERSONALITY_MAX_LENGTH}.`,
      };
    }

    const personalityId = await server.memoryManager.upsertPersonalityMemory(
      actorId,
      payload.memory,
    );
    this.logger.debug("Updated personality memory:", {
      actorId,
      personalityId,
      memory: payload.memory,
    });
    return {
      success: true,
      content: "OK",
    };
  }
}
