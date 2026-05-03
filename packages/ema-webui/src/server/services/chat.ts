import "server-only";

import type { InputContent as CoreInputContent } from "ema";
import { toWebConversationMessage } from "@/server/ema-adapter/chat";
import {
  DEFAULT_OWNER_USER_ID,
  DEFAULT_WEB_SESSION,
  toCoreActorId,
} from "@/server/ema-adapter/ids";
import { ensureEmaServer } from "@/server/ema-server";
import type {
  ChatHistoryResponse,
  GetChatHistoryParams,
  InputContent,
  SendMessageRequest,
  SendMessageResponse,
} from "@/types/chat/v1beta1";

const API_VERSION = "v1beta1" as const;

export async function buildChatHistory({
  actorId,
  session,
  limit,
  beforeMsgId,
}: GetChatHistoryParams): Promise<ChatHistoryResponse> {
  const server = await ensureEmaServer();
  const result = await server.controller.chat.listHistory({
    actorId: toCoreActorId(actorId),
    session,
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof beforeMsgId === "number" ? { beforeMsgId } : {}),
  });

  return {
    apiVersion: API_VERSION,
    generatedAt: new Date().toISOString(),
    actorId,
    session: result.session,
    messages: result.messages.map(toWebConversationMessage),
    pagination: result.pagination,
  };
}

export async function sendConversationMessage({
  actorId,
  request,
}: {
  actorId: string;
  request: SendMessageRequest;
}): Promise<SendMessageResponse> {
  const server = await ensureEmaServer();
  const owner = await server.dbService.getDefaultUser();
  const result = await server.controller.chat.sendWebMessage({
    actorId: toCoreActorId(actorId),
    ownerUserId: owner?.id ?? DEFAULT_OWNER_USER_ID,
    ownerName: owner?.name ?? "你",
    correlationId: request.correlationId,
    contents: toCoreInputContents(
      Array.isArray(request.contents) ? request.contents : [],
    ),
    ...(request.replyTo ? { replyTo: request.replyTo } : {}),
  });

  return {
    apiVersion: API_VERSION,
    correlationId: result.correlationId,
    msgId: result.message.msgId,
    message: toWebConversationMessage(result.message),
  };
}

export function getDefaultWebSession() {
  return DEFAULT_WEB_SESSION;
}

function toCoreInputContents(contents: InputContent[]): CoreInputContent[] {
  return contents.map((content) => ({ ...content }) as CoreInputContent);
}
