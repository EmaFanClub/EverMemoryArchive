import "server-only";

import type { EmaKnownEvent, EmaEventTopic } from "@/types/events/v1beta1";

export function eventMatchesTopics(
  event: EmaKnownEvent,
  topics: EmaEventTopic[] | null,
) {
  return !topics || topics.length === 0 || topics.includes(event.type);
}

export function eventMatchesConversation(
  event: EmaKnownEvent,
  conversationId: string,
  actorId?: string,
) {
  if (
    event.type !== "conversation.message.created" &&
    event.type !== "conversation.typing.changed"
  ) {
    return false;
  }
  if (event.conversationId !== conversationId) {
    return false;
  }
  return !actorId || event.actorId === actorId;
}
