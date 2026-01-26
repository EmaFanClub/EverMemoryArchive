/**
 * SSE endpoint for subscribing to actor events at /api/actor/sse.
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../../shared-server";
import * as k from "arktype";
import { getQuery } from "../../utils";
import type { ActorAgentEvent } from "ema";

const ActorSseRequest = k.type({
  userId: "string.numeric",
  actorId: "string.numeric",
  conversationId: "string.numeric",
});

/**
 * Subscribes to actor events.
 *
 * Query params:
 *   - userId (`number`): User ID
 *   - actorId (`number`): Actor ID
 *   - conversationId (`number`): Conversation ID
 *
 * Returns a SSE stream of actor events.
 *
 * @example
 * ```ts
 * // Subscribe to actor events
 * const eventSource =
 *   new EventSource("/api/actor/sse?userId=1&actorId=1&conversationId=1");
 *
 * eventSource.onmessage = (event) => {
 *   const response = JSON.parse(event.data);
 *   console.log(response);
 * };
 * ```
 */
export const GET = getQuery(ActorSseRequest)(async (query) => {
  const server = await getServer();
  const actor = await server.getActor(
    Number.parseInt(query.userId),
    Number.parseInt(query.actorId),
    Number.parseInt(query.conversationId),
  );
  const encoder = new TextEncoder();
  /* The handle to unsubscribe from the actor events. */
  let eventCallback: (event: ActorAgentEvent) => void;

  const customReadable = new ReadableStream({
    start(controller) {
      eventCallback = (event) => {
        if (event.kind !== "emaReplyReceived") {
          return;
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      actor.events.on("agent", eventCallback);
    },
    cancel() {
      if (eventCallback) {
        actor.events.off("agent", eventCallback);
      }
    },
  });

  return new Response(customReadable, {
    headers: {
      Connection: "keep-alive",
      "Content-Encoding": "none",
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
});
