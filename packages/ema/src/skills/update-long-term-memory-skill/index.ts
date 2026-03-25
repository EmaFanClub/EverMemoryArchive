import { z } from "zod";
import { countApproxTextLength, Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import type { LongTermMemory } from "../../memory/base";
import { getMemoryUpdateTaskData } from "../../memory/update_tasks";
import { Logger } from "../../logger";
import {
  type UpdateLongTermMemoryDTO,
  Index0Enum,
  Index1Enum,
  isAllowedIndex1,
} from "../../memory/utils";

const LONG_TERM_MEMORY_MAX_LENGTH = 100;

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
  description =
    "该技能用于写入跨会话可复用的长期事实、关系线索、历史事件与知识，用于补足当前上下文之外的重要背景。";

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
        error: `Invalid update-long-term-memory-skill input: ${(err as Error).message}. Use get_skill to check the required parameters and their formats.`,
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
    if (actualLength > LONG_TERM_MEMORY_MAX_LENGTH) {
      return {
        success: false,
        error: `memory is too long: got approximately ${actualLength}, max ${LONG_TERM_MEMORY_MAX_LENGTH}.`,
      };
    }

    const record: LongTermMemory = {
      index0: payload.index0,
      index1: payload.index1,
      memory: payload.memory,
      createdAt: getMemoryUpdateTaskData(context?.data)?.triggeredAt,
      messages: payload.msg_ids,
    };
    await server.memoryManager.addLongTermMemory(actorId, record);
    this.logger.debug("Updated long-term memory:", record);
    return {
      success: true,
      content: "OK",
    };
  }
}
