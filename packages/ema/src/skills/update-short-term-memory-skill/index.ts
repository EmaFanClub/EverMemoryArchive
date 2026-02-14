import { z } from "zod";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import type { ShortTermMemory } from "../../memory/base";
import { Logger } from "../../logger";

const UpdateShortTermMemorySchema = z
  .object({
    kind: z.enum(["year", "month", "week", "day"]).describe("短期记忆类型"),
    memory: z.string().min(1).describe("记忆内容"),
  })
  .strict();

export default class UpdateShortTermMemorySkill extends Skill {
  description =
    "基于已有短期记忆 + 近期对话，生成全量更新后的短期记忆（年/月/周/日），用于事实回忆与人格形成。";

  parameters = UpdateShortTermMemorySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "UpdateShortTermMemorySkill",
    level: "full",
    transport: "console",
  });

  /**
   * Appends a short-term memory record for the current actor.
   * @param args - Arguments containing kind and memory.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof UpdateShortTermMemorySchema>;
    try {
      payload = UpdateShortTermMemorySchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid update-short-term-memory-skill input: ${(err as Error).message}`,
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
    if (!actorScope?.actorId) {
      return {
        success: false,
        error: "Missing actorId in skill context.",
      };
    }

    const record: ShortTermMemory = {
      kind: payload.kind,
      memory: payload.memory,
    };
    await server.memoryManager.addShortTermMemory(actorScope.actorId, record);
    this.logger.debug("Updated short-term memory:", record);
    return {
      success: true,
      content: "OK",
    };
  }
}
