import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import type { ConversationMessageEntity } from "../../db/base";
import { formatTimestamp, parseTimestamp } from "../../utils";

const TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

const QueryByTimeRangeSchema = z
  .object({
    mode: z.literal("by_time_range").describe("按时间范围检索消息"),
    start_time: z
      .string()
      .min(1)
      .describe('起始时间，格式为 "YYYY-MM-DD HH:mm:ss"'),
    end_time: z
      .string()
      .min(1)
      .describe('结束时间，格式为 "YYYY-MM-DD HH:mm:ss"'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT)
      .describe("返回数量上限，默认50，最大50"),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      const start = parseTime(value.start_time, "start_time");
      const end = parseTime(value.end_time, "end_time");
      if (start > end) {
        ctx.addIssue({
          code: "custom",
          path: ["start_time"],
          message: "start_time must be less than or equal to end_time.",
        });
      }
    } catch {
      // parseTime already throws a readable message; execute() will surface it.
    }
  });

const QueryByIdsSchema = z
  .object({
    mode: z.literal("by_ids").describe("按消息ID列表检索消息"),
    msg_ids: z.array(z.number().int().positive()).min(1).describe("消息ID列表"),
  })
  .strict();

const QueryChatHistorySchema = z.discriminatedUnion("mode", [
  QueryByTimeRangeSchema,
  QueryByIdsSchema,
]);

type QueryChatHistoryInput = z.infer<typeof QueryChatHistorySchema>;

/**
 * Parses timestamp text using the project-wide time format.
 * @param value - Timestamp text.
 * @param field - Field name used in error messages.
 * @returns Unix timestamp in milliseconds.
 */
function parseTime(value: string, field: string): number {
  try {
    return parseTimestamp(TIME_FORMAT, value);
  } catch {
    throw new Error(`${field} must be in format "${TIME_FORMAT}".`);
  }
}

/**
 * Formats a conversation message entity into a serializable DTO.
 * @param entity - Conversation message entity.
 * @returns Serialized message object.
 */
function formatMessage(entity: ConversationMessageEntity) {
  if (typeof entity.id !== "number") {
    throw new Error("Conversation message is missing id.");
  }
  const message = entity.message;
  return {
    msg_id: entity.id,
    role: message.kind,
    role_id: message.kind === "user" ? message.userId : message.actorId,
    time: formatTimestamp(TIME_FORMAT, entity.createdAt ?? Date.now()),
    contents: message.contents,
  };
}

export default class QueryChatHistorySkill extends Skill {
  description = "按时间范围或消息ID检索当前会话的聊天记录，支持分页状态返回。";

  parameters = QueryChatHistorySchema.toJSONSchema();

  /**
   * Queries conversation history for the current actor scope.
   * @param args - Query arguments.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: any, context?: ToolContext): Promise<ToolResult> {
    let payload: QueryChatHistoryInput;
    try {
      payload = QueryChatHistorySchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid query-chat-history-skill input: ${(err as Error).message}`,
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
    if (!actorScope?.conversationId) {
      return {
        success: false,
        error: "Missing conversationId in skill context.",
      };
    }

    try {
      if (payload.mode === "by_ids") {
        const rows =
          await server.conversationMessageDB.listConversationMessages({
            conversationId: actorScope.conversationId,
            messageIds: payload.msg_ids,
          });
        const byId = new Map(
          rows
            .filter(
              (item): item is ConversationMessageEntity & { id: number } =>
                typeof item.id === "number",
            )
            .map((item) => [item.id, item]),
        );
        const orderedEntities: ConversationMessageEntity[] = [];
        for (const id of payload.msg_ids) {
          const item = byId.get(id);
          if (item) {
            orderedEntities.push(item);
          }
        }
        const ordered = orderedEntities.map(formatMessage);
        return {
          success: true,
          content: JSON.stringify({
            mode: payload.mode,
            requested_msg_ids: payload.msg_ids,
            found_count: ordered.length,
            missing_msg_ids: payload.msg_ids.filter((id) => !byId.has(id)),
            messages: ordered,
          }),
        };
      }

      const startTime = parseTime(payload.start_time, "start_time");
      const endTime = parseTime(payload.end_time, "end_time");
      if (startTime > endTime) {
        return {
          success: false,
          error: "start_time must be less than or equal to end_time.",
        };
      }

      const rows = await server.conversationMessageDB.listConversationMessages({
        conversationId: actorScope.conversationId,
        createdAfter: startTime,
        createdBefore: endTime,
        sort: "asc",
        limit: payload.limit + 1,
      });
      const hasMore = rows.length > payload.limit;
      const page = hasMore ? rows.slice(0, payload.limit) : rows;
      const messages = page.map(formatMessage);
      const last = messages[messages.length - 1];
      return {
        success: true,
        content: JSON.stringify({
          mode: payload.mode,
          range: {
            start_time: payload.start_time,
            end_time: payload.end_time,
          },
          limit: payload.limit,
          has_more: hasMore,
          last_message_time: last?.time ?? null,
          last_msg_id: last?.msg_id ?? null,
          messages,
        }),
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to query chat history: ${(error as Error).message}`,
      };
    }
  }
}
