import { z } from "zod";
import { countApproxTextLength, Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import type { LongTermMemory } from "../../memory/base";
import { getShortTermMemoryTaskData } from "../../memory/utils";
import { Logger } from "../../logger";
import { Index0Enum, Index1Enum } from "../../memory/utils";
import { formatTimestamp } from "../../utils";

const LONG_TERM_MEMORY_MAX_LENGTH = 100;

const AddOperationSchema = z
  .object({
    op: z.literal("add").describe("操作类型"),
    index0: Index0Enum.describe("一级分类（必填）"),
    index1: Index1Enum.describe("二级分类（必填）"),
    memory: z.string().min(1).describe("长期记忆内容"),
    msg_ids: z
      .array(z.number().int().positive())
      .optional()
      .describe("该记忆关联的消息ID列表（可选）"),
  })
  .strict();

const UpdateOperationSchema = z
  .object({
    op: z.literal("update"),
    id: z.number().int().positive(),
    index0: Index0Enum,
    index1: Index1Enum,
    memory: z.string().min(1),
    msg_ids: z.array(z.number().int().positive()).optional(),
  })
  .strict();

const DeleteOperationSchema = z
  .object({
    op: z.literal("delete"),
    id: z.number().int().positive(),
  })
  .strict();

type AddOperation = z.infer<typeof AddOperationSchema>;
type UpdateOperation = z.infer<typeof UpdateOperationSchema>;
type DeleteOperation = z.infer<typeof DeleteOperationSchema>;

export type ReservedLongTermMemoryOperation =
  | AddOperation
  | UpdateOperation
  | DeleteOperation;

export const UpdateLongTermMemorySchema = z
  .object({
    operations: z
      .array(AddOperationSchema)
      .min(1)
      .describe("批量长期记忆写入请求"),
  })
  .strict();

export default class UpdateLongTermMemorySkill extends Skill {
  description =
    "此技能用于写入长期记忆，把当前任务中值得长期保留的人物、事件、知识或经验信息批量保存到跨会话记忆库中。";

  parameters = UpdateLongTermMemorySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "UpdateLongTermMemorySkill",
    level: "full",
    transport: "console",
  });

  /**
   * Appends long-term memory records for the current actor in batches.
   * @param args - Arguments containing grouped add operations.
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

    const createdAt = getShortTermMemoryTaskData(context?.data)?.triggeredAt;
    const results: { id: number; createdAt: string }[] = [];

    for (let i = 0; i < payload.operations.length; i++) {
      const operation = payload.operations[i];
      const actualLength = countApproxTextLength(operation.memory);
      if (actualLength > LONG_TERM_MEMORY_MAX_LENGTH) {
        return {
          success: false,
          error: `operations[${i}].memory is too long: got approximately ${actualLength}, max ${LONG_TERM_MEMORY_MAX_LENGTH}.`,
        };
      }

      const record: LongTermMemory = {
        index0: operation.index0,
        index1: operation.index1,
        memory: operation.memory,
        createdAt,
        messages: operation.msg_ids,
      };
      const id = await server.memoryManager.addLongTermMemory(actorId, record);
      const createdAtValue = createdAt ?? Date.now();
      results.push({
        id,
        createdAt: formatTimestamp("YYYY-MM-DD HH:mm:ss", createdAtValue),
      });
    }

    this.logger.debug("Updated long-term memory:", payload.operations);
    return {
      success: true,
      content: JSON.stringify({ results }),
    };
  }
}
