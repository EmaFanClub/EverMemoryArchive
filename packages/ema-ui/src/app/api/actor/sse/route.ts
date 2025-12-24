/**
 * SSE endpoint for subscribing to actor events at /api/actor/sse.
 * See https://nextjs.org/blog/building-apis-with-nextjs#32-multiple-http-methods-in-one-file
 */

import { getServer } from "../../shared-server";
import * as k from "arktype";
import { getQuery } from "../../utils";
import type { ActorResponse } from "ema";

const ActorSseRequest = k.type({
  userId: "string.numeric",
  actorId: "string.numeric",
});

/**
 * GET /api/actor/sse - Subscribes to actor events
 * Query params:
 *   - userId: User ID
 *   - actorId: Actor ID
 *
 * Returns a SSE stream of actor events.
 */
export const GET = getQuery(ActorSseRequest)(async (query) => {
  const server = await getServer();
  const actor = await server.getActor(
    Number.parseInt(query.userId),
    Number.parseInt(query.actorId),
  );
  const encoder = new TextEncoder();
  /* The handle to unsubscribe from the actor events. */
  let eventCallback: (response: ActorResponse) => void;

  const customReadable = new ReadableStream({
    start(controller) {
      actor.subscribe(
        (eventCallback = (response) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(response)}\n\n`),
          );
        }),
      );
    },
    cancel() {
      if (eventCallback) {
        actor.unsubscribe(eventCallback);
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
