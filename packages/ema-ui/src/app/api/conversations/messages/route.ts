/**
 * Conversation messages endpoint.
 */

import { getServer } from "../../shared-server";
import type { ConversationMessage } from "ema";
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

  const messages: ConversationMessage[] = rows
    .reverse()
    .map((row) => row.message);

  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
