import { z } from "zod";
import { Tool } from "./base";
import type { ToolContext, ToolResult } from "./base";

const ListConversationsSchema = z.object({}).strict();

/**
 * Tool for listing actor-owned conversations.
 */
export class ListConversationsTool extends Tool {
  name = "list_conversations";

  description =
    "此工具用于查看当前所有的会话列表，在需要安排主动对话或确认对话场景信息时使用。";

  parameters = ListConversationsSchema.toJSONSchema();

  /**
   * Lists conversations for the current actor.
   * @param args - Tool arguments.
   * @param context - Tool context containing server and actor scope.
   */
  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    try {
      ListConversationsSchema.parse(args ?? {});
    } catch (err) {
      return {
        success: false,
        error: `Invalid list_conversations input: ${(err as Error).message}`,
      };
    }

    const server = context?.server;
    const actorId = context?.actorId;
    if (!server) {
      return {
        success: false,
        error: "Missing server in tool context.",
      };
    }
    if (!actorId) {
      return {
        success: false,
        error: "Missing actorId in tool context.",
      };
    }

    const conversations =
      await server.dbService.conversationDB.listConversations({
        actorId,
      });
    conversations.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));

    return {
      success: true,
      content: JSON.stringify({
        conversations: conversations.map((conversation) => ({
          conversationId: conversation.id,
          session: conversation.session,
          name: conversation.name,
          description: conversation.description,
          allowProactive: conversation.allowProactive ?? false,
        })),
      }),
    };
  }
}
