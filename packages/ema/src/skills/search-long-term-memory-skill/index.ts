import { z } from "zod";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import { Index0Enum, Index1Enum } from "../../memory/utils";
import { formatTimestamp } from "../../utils";
import { Logger } from "../../logger";

export const SearchLongTermMemoryQuerySchema = z
  .object({
    index0: Index0Enum.describe("一级分类（必填）"),
    index1: z
      .union([Index1Enum, z.literal("")])
      .optional()
      .default("")
      .describe("二级分类（可选，不指定时填空字符串）"),
    memory: z.string().min(1).describe("要检索的长期记忆内容"),
    limit: z.number().int().min(10).max(50).describe("返回数量上限（10-50）"),
  })
  .strict();

export const SearchLongTermMemorySchema = z
  .object({
    queries: z
      .array(SearchLongTermMemoryQuerySchema)
      .min(1)
      .describe("批量长期记忆检索请求"),
  })
  .strict();

export default class SearchLongTermMemorySkill extends Skill {
  description =
    "此技能用于检索长期记忆，从跨会话长期记忆中补充人物、事件、知识或经验信息。";

  parameters = SearchLongTermMemorySchema.toJSONSchema();

  private logger: Logger = Logger.create({
    name: "SearchLongTermMemorySkill",
    level: "debug",
    transport: "console",
  });

  /**
   * Searches long-term memory records for the current actor in grouped batches.
   * @param args - Arguments containing grouped long-term-memory queries.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: z.infer<typeof SearchLongTermMemorySchema>;
    try {
      payload = SearchLongTermMemorySchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid search-long-term-memory-skill input: ${(err as Error).message}. Use get_skill to check the required parameters and their formats.`,
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

    const results = await Promise.all(
      payload.queries.map(async (query) => {
        const records = await server.memoryManager.search(
          actorId,
          query.memory,
          query.limit,
          query.index0,
          query.index1,
        );
        return {
          query,
          hints: records.map((record) => ({
            id: record.id,
            memory: record.memory,
            createdAt: formatTimestamp(
              "YYYY-MM-DD HH:mm:ss",
              record.createdAt ?? Date.now(),
            ),
            ...(record.messages ? { msg_ids: record.messages } : {}),
          })),
        };
      }),
    );
    this.logger.debug("Search-long-term-memory-skill results:", results);
    return {
      success: true,
      content: JSON.stringify({ results }),
    };
  }
}
