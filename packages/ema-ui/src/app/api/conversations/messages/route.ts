/**
 * Conversation messages endpoint.
 */

import { getServer } from "../../shared-server";
import type { Message } from "ema";
import * as k from "arktype";
import { getQuery } from "../../utils";

const ConversationMessagesRequest = k.type({
  conversationId: "string.numeric",
  "limit?": "string.numeric",
});

export const GET = getQuery(ConversationMessagesRequest)(async (query) => {
  const server = await getServer();
  const conversationId = Number.parseInt(query.conversationId, 10);
  const limit =
    query.limit !== undefined ? Number.parseInt(query.limit, 10) : undefined;

  const rows = await server.conversationMessageDB.listConversationMessages({
    conversationId,
    limit,
    sort: "desc",
  });

  const messages: Message[] = rows.reverse().map((row) => {
    const msg = row.message;
    if (msg.kind === "user") {
      return { role: "user", contents: msg.contents };
    }
    return { role: "model", contents: msg.contents };
  });

  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
