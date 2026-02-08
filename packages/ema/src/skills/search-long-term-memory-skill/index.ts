import dayjs from "dayjs";
import { z } from "zod";
import { Skill } from "../base";
import type { ToolResult, ToolContext } from "../../tools/base";
import { Index0Enum, Index1Enum, isAllowedIndex1 } from "../../memory/utils";

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
  description = "检索长期记忆。";

  parameters = SearchLongTermMemorySchema.toJSONSchema();

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

    const records = await server.memoryManager.search(
      actorScope.actorId,
      payload.memory,
      payload.limit,
      payload.index0,
      payload.index1,
    );
    const formatted = records.map((record) => ({
      ...record,
      createdAt: dayjs(record.createdAt).format("YYYY-MM-DD HH:mm:ss"),
    }));
    return {
      success: true,
      content: JSON.stringify(formatted),
    };
  }
}
