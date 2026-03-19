import { z } from "zod";
import { countApproxTextLength, Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import type { ShortTermMemory } from "../../memory/base";
import { Logger } from "../../logger";

const SHORT_TERM_MEMORY_MAX_LENGTH = {
  day: 500,
  week: 700,
  month: 1000,
  year: 2000,
} as const;

const UpdateShortTermMemorySchema = z
  .object({
    kind: z.enum(["year", "month", "week", "day"]).describe("短期记忆类型"),
    memory: z.string().min(1).describe("记忆内容"),
  })
  .strict();

export default class UpdateShortTermMemorySkill extends Skill {
  description =
    "该技能用于更新短期记忆（年/月/周/日），用于记录角色最近一段时间的经历、情绪与关系惯性。只有在系统明确要求更新 day、week、month 或 year 时才可以更新。";

  parameters = UpdateShortTermMemorySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "UpdateShortTermMemorySkill",
    level: "full",
    transport: "console",
  });

  /**
   * Upserts the latest short-term memory record for the current actor.
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
    if (
      context?.updateMemoryKinds &&
      !context.updateMemoryKinds.includes(payload.kind)
    ) {
      return {
        success: false,
        error: `Kind '${payload.kind}' is not allowed in current updateMemoryKinds: [${context.updateMemoryKinds.join(", ")}].`,
      };
    }

    const maxLength = SHORT_TERM_MEMORY_MAX_LENGTH[payload.kind];
    const actualLength = countApproxTextLength(payload.memory);
    if (actualLength > maxLength) {
      return {
        success: false,
        error: `memory is too long for kind '${payload.kind}': got approximately ${actualLength}, max ${maxLength}.`,
      };
    }

    const record: ShortTermMemory = {
      kind: payload.kind,
      memory: payload.memory,
    };
    await server.memoryManager.upsertLatestShortTermMemory(actorId, record);
    this.logger.debug("Upserted short-term memory:", record);
    return {
      success: true,
      content: "OK",
    };
  }
}
