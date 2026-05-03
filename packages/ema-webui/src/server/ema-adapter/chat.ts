import "server-only";

import type {
  ConversationMessageStreamEvent,
  ConversationTypingStreamEvent,
  InputContent as CoreInputContent,
} from "ema";
import type {
  ConversationActorMessage,
  ConversationMessage,
  ConversationUserMessage,
  InputContent,
} from "@/types/chat/v1beta1";
import type {
  ConversationMessageCreatedEventData,
  ConversationTypingChangedEventData,
  EmaEvent,
} from "@/types/events/v1beta1";
import { toWebActorId, toWebConversationId } from "./ids";

export function toWebInputContents(
  contents: CoreInputContent[],
): InputContent[] {
  return contents.map((content) => ({ ...content }) as InputContent);
}

export function toWebConversationMessage(
  entity: ConversationMessageStreamEvent["message"],
): ConversationMessage {
  const base = {
    msgId: entity.msgId,
    time: entity.createdAt,
    contents: toWebInputContents(entity.message.contents),
    ...(entity.message.replyTo ? { replyTo: entity.message.replyTo } : {}),
  };

  if (entity.message.kind === "user") {
    return {
      ...base,
      kind: "user",
      uid: entity.message.uid,
      name: entity.message.name,
    } satisfies ConversationUserMessage;
  }

  return {
    ...base,
    kind: "actor",
    name: entity.message.name,
    ...(entity.message.think ? { think: entity.message.think } : {}),
  } satisfies ConversationActorMessage;
}

export function toConversationMessageCreatedEvent(
  event: ConversationMessageStreamEvent,
): EmaEvent<
  "conversation.message.created",
  ConversationMessageCreatedEventData
> {
  return {
    type: "conversation.message.created",
    ts: Date.now(),
    actorId: toWebActorId(event.actorId),
    conversationId: toWebConversationId(event.session),
    ...(event.correlationId ? { correlationId: event.correlationId } : {}),
    data: {
      message: toWebConversationMessage(event.message),
    },
  };
}

export function toConversationTypingChangedEvent(
  event: ConversationTypingStreamEvent,
): EmaEvent<"conversation.typing.changed", ConversationTypingChangedEventData> {
  return {
    type: "conversation.typing.changed",
    ts: event.updatedAt,
    actorId: toWebActorId(event.actorId),
    conversationId: toWebConversationId(event.session),
    data: {
      typing: event.typing,
    },
  };
}
