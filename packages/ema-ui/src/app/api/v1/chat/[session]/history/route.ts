import type { ConversationMessage } from "ema";
import { buildSession, resolveSession } from "ema";
import { getServer } from "../../../../shared-server";

const DEFAULT_ACTOR_ID = 1;

export async function GET(
  request: Request,
  context: { params: Promise<{ session: string }> },
) {
  const { session: rawSession } = await context.params;
  const session = resolveSession(rawSession)
    ? rawSession
    : buildSession("web", "chat", rawSession);
  const url = new URL(request.url);
  const limitText = url.searchParams.get("limit");
  const limit = limitText ? Number.parseInt(limitText, 10) : undefined;

  const server = await getServer();
  const conversation = await server.dbService.getConversationBySession(
    DEFAULT_ACTOR_ID,
    session,
  );
  if (!conversation) {
    return new Response(JSON.stringify({ error: "Conversation not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows =
    await server.dbService.conversationMessageDB.listConversationMessages({
      conversationId: conversation.id!,
      limit,
      sort: "desc",
    });

  const messages: ConversationMessage[] = rows.reverse().map((row) => ({
    ...row.message,
    msgId: row.msgId,
  }));

  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
