import {
  toConversationMessageCreatedEvent,
  toConversationTypingChangedEvent,
} from "@/server/ema-adapter/chat";
import { toCoreActorId } from "@/server/ema-adapter/ids";
import { ensureEmaServer } from "@/server/ema-server";
import { createSubscribedSseStream, sseResponse } from "@/server/events/sse";
import { eventMatchesConversation } from "@/server/events/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  const { actorId, session } = await context.params;
  const server = await ensureEmaServer();
  const coreActorId = toCoreActorId(actorId);
  const typingSnapshot =
    await server.controller.chat.getConversationTypingSnapshot(
      coreActorId,
      session,
    );
  const initialTypingEvent = toConversationTypingChangedEvent(typingSnapshot);

  return sseResponse(
    createSubscribedSseStream({
      request,
      filter: (event) => eventMatchesConversation(event, session, actorId),
      initialEvents: [initialTypingEvent],
      subscribe: (handler) =>
        server.controller.chat.subscribeConversation(
          typingSnapshot.conversationId,
          (event) => {
            const webEvent =
              event.type === "message.created"
                ? toConversationMessageCreatedEvent(event)
                : toConversationTypingChangedEvent(event);
            handler(webEvent);
          },
        ),
    }),
  );
}
