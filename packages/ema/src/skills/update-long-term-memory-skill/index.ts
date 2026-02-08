import { z } from "zod";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import type { LongTermMemory } from "../../memory/base";
import { Logger } from "../../logger";
import {
  type UpdateLongTermMemoryDTO,
  Index0Enum,
  Index1Enum,
  isAllowedIndex1,
} from "../../memory/utils";

export const UpdateLongTermMemorySchema: z.ZodType<UpdateLongTermMemoryDTO> = z
  .object({
    index0: Index0Enum.describe("一级分类（必填）"),
    index1: Index1Enum.describe("二级分类（必填）"),
    memory: z.string().min(1).describe("长期记忆内容"),
    msg_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe("该记忆关联的消息ID列表（可选）"),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!isAllowedIndex1(val.index0, val.index1)) {
      ctx.addIssue({
        code: "custom",
        path: ["index1"],
        message: `index1="${val.index1}" is not allowed for index0="${val.index0}".`,
      });
    }
  });

export default class UpdateLongTermMemorySkill extends Skill {
  description = "基于近期对话与已有记忆，提炼跨会话可复用的长期记忆条目。";

  parameters = UpdateLongTermMemorySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "UpdateLongTermMemorySkill",
    level: "full",
    transport: "console",
  });

  /**
   * Appends a long-term memory record for the current actor.
   * @param args - Arguments containing indices and memory.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof UpdateLongTermMemorySchema>;
    try {
      payload = UpdateLongTermMemorySchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid update-long-term-memory-skill input: ${(err as Error).message}`,
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

    const record: LongTermMemory = {
      index0: payload.index0,
      index1: payload.index1,
      memory: payload.memory,
      messages: payload.msg_ids,
    };
    await server.memoryManager.addLongTermMemory(actorScope.actorId, record);
    this.logger.debug("Updated long-term memory:", record);
    return {
      success: true,
      content: "OK",
    };
  }
}
