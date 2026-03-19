import { z } from "zod";
import { Skill } from "../base";
import type { ToolContext, ToolResult } from "../../tools/base";
import type { ConversationMessageEntity } from "../../db/base";
import { resolveSession } from "../../channel";
import type { BufferMessage } from "../../memory/base";
import { buildPromptFromBufferMessage } from "../../memory/utils";
import { parseTimestamp } from "../../utils";

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

const QueryExpandOneSchema = z
  .object({
    mode: z
      .literal("expand_one")
      .describe("展开单条消息中的原始图片或文件内容"),
    msg_id: z.number().int().positive().describe("需要展开的消息ID"),
  })
  .strict();

const QueryChatHistorySchema = z.discriminatedUnion("mode", [
  QueryByTimeRangeSchema,
  QueryByIdsSchema,
  QueryExpandOneSchema,
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
 * Formats a conversation message entity into the same summary style used by buffer prompts.
 * @param entity - Conversation message entity.
 * @param session - Conversation session string.
 * @param ownerUid - Current owner uid used for speaker classification.
 * @returns Prompt-friendly summary line.
 */
function formatMessage(
  entity: ConversationMessageEntity,
  session: string,
  ownerUid: string | null,
): string {
  if (typeof entity.msgId !== "number") {
    throw new Error("Conversation message is missing msgId.");
  }
  const message = entity.message;
  const bufferMessage: BufferMessage =
    message.kind === "user"
      ? {
          kind: "user",
          speaker: {
            session,
            uid: message.uid,
            name: message.name,
          },
          msgId: entity.msgId,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          contents: message.contents,
          time: entity.createdAt ?? Date.now(),
        }
      : {
          kind: "actor",
          msgId: entity.msgId,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          contents: message.contents,
          ...(message.think ? { think: message.think } : {}),
          time: entity.createdAt ?? Date.now(),
        };
  return buildPromptFromBufferMessage(bufferMessage, ownerUid);
}

function extractMediaParts(
  entity: ConversationMessageEntity,
): NonNullable<ToolResult["parts"]> {
  return entity.message.contents.filter(
    (content): content is NonNullable<ToolResult["parts"]>[number] =>
      content.type === "inline_data",
  );
}

export default class QueryChatHistorySkill extends Skill {
  description =
    "该技能用于查询当前会话中的真实聊天记录，或者查看某条消息中的媒体内容。需要精确回溯某条消息内容、查看消息中的图片或文件的具体内容时使用。";

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
    const actorId = context?.actorId;
    const conversationId = context?.conversationId;
    if (!server) {
      return {
        success: false,
        error: "Missing server in skill context.",
      };
    }
    if (!conversationId) {
      return {
        success: false,
        error: "Missing conversationId in skill context.",
      };
    }

    try {
      const conversation =
        await server.conversationDB.getConversation(conversationId);
      if (!conversation) {
        return {
          success: false,
          error: "Conversation not found.",
        };
      }
      const ownerUid = (() => {
        if (!actorId) {
          return Promise.resolve<string | null>(null);
        }
        const sessionInfo = resolveSession(conversation.session);
        if (!sessionInfo) {
          return Promise.resolve<string | null>(null);
        }
        return server.memoryManager.getOwnerUid(actorId, sessionInfo.channel);
      })();
      const resolvedOwnerUid = await ownerUid;

      if (payload.mode === "expand_one") {
        const rows =
          await server.conversationMessageDB.listConversationMessages({
            conversationId,
            actorId,
            msgIds: [payload.msg_id],
            limit: 1,
          });
        const row = rows[0];
        if (!row) {
          return {
            success: false,
            error: `Message ${payload.msg_id} not found.`,
          };
        }
        const parts = extractMediaParts(row);
        if (parts.length === 0) {
          return {
            success: false,
            error: `Message ${payload.msg_id} has no expandable media parts.`,
          };
        }
        return {
          success: true,
          parts,
        };
      }

      if (payload.mode === "by_ids") {
        const rows =
          await server.conversationMessageDB.listConversationMessages({
            conversationId,
            actorId,
            msgIds: payload.msg_ids,
          });
        const byId = new Map(
          rows
            .filter(
              (item): item is ConversationMessageEntity & { msgId: number } =>
                typeof item.msgId === "number",
            )
            .map((item) => [item.msgId, item]),
        );
        const orderedEntities: ConversationMessageEntity[] = [];
        for (const id of payload.msg_ids) {
          const item = byId.get(id);
          if (item) {
            orderedEntities.push(item);
          }
        }
        const ordered = orderedEntities.map((item) =>
          formatMessage(item, conversation.session, resolvedOwnerUid),
        );
        return {
          success: true,
          content: ordered.length > 0 ? ordered.join("\n") : "None.",
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
        conversationId,
        createdAfter: startTime,
        createdBefore: endTime,
        sort: "asc",
        limit: payload.limit + 1,
      });
      const hasMore = rows.length > payload.limit;
      const page = hasMore ? rows.slice(0, payload.limit) : rows;
      const messages = page.map((item) =>
        formatMessage(item, conversation.session, resolvedOwnerUid),
      );
      const content = messages.length > 0 ? messages.join("\n") : "None.";
      return {
        success: true,
        content: hasMore ? `${content}\n(more messages omitted.)` : content,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to query chat history: ${(error as Error).message}`,
      };
    }
  }
}
