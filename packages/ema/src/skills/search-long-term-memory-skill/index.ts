import { z } from "zod";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import { Index0Enum, Index1Enum, isAllowedIndex1 } from "../../memory/utils";
import { formatTimestamp } from "../../utils";
import { Logger } from "../../logger";

export const SearchLongTermMemorySchema = z
  .object({
    memory: z.string().min(1).describe("要检索的记忆内容"),
    limit: z.number().int().min(1).max(50).describe("返回数量上限"),
    index0: Index0Enum.optional().describe("一级分类（可选）"),
    index1: Index1Enum.optional().describe("二级分类（可选）"),
  })
  .strict()
  .superRefine((val, ctx) => {
    // disallow index1 without index0
    if (!val.index0 && val.index1 !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["index1"],
        message: "index1 cannot be provided without index0.",
      });
      return;
    }

    // if both provided, validate pair
    if (val.index0 && val.index1 !== undefined) {
      if (!isAllowedIndex1(val.index0, val.index1)) {
        ctx.addIssue({
          code: "custom",
          path: ["index1"],
          message: `index1="${val.index1}" is not allowed for index0="${val.index0}".`,
        });
      }
    }
  });

export default class SearchLongTermMemorySkill extends Skill {
  description =
    "该技能用于检索与当前对话相关的长期记忆，用于补足当前上下文之外的重要事实与关系背景。在回复前必须进行检索，以补充和说话者、话题、事件相关的长期记忆，以便更好地理解当前对话环境和历史背景。";

  parameters = SearchLongTermMemorySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "SearchLongTermMemorySkill",
    level: "debug",
    transport: "console",
  });

  /**
   * Searches long-term memory records for the current actor.
   * @param args - Arguments containing memory, limit, and optional indices.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof SearchLongTermMemorySchema>;
    try {
      payload = SearchLongTermMemorySchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid search-long-term-memory-skill input: ${(err as Error).message}`,
      };
    }
    this.logger.debug("Searching long-term memory:", payload);
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

    const records = await server.memoryManager.search(
      actorId,
      payload.memory,
      payload.limit,
      payload.index0,
      payload.index1,
    );
    const formatted = records.map((record) => ({
      ...record,
      createdAt: formatTimestamp(
        "YYYY-MM-DD HH:mm:ss",
        record.createdAt ?? Date.now(),
      ),
    }));
    return {
      success: true,
      content: JSON.stringify(formatted),
    };
  }
}
