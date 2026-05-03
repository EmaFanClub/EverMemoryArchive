import "server-only";

import type { EmaKnownEvent, EmaEventTopic } from "@/types/events/v1beta1";

const KEEPALIVE_INTERVAL_MS = 15000;
type SseEventHandler = (event: EmaKnownEvent) => void;
type SseSubscribe = (handler: SseEventHandler) => () => void;

function encodeSse(event: EmaKnownEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createSubscribedSseStream({
  request,
  filter,
  subscribe,
  initialEvents = [],
}: {
  request: Request;
  filter: (event: EmaKnownEvent) => boolean;
  subscribe: SseSubscribe;
  initialEvents?: EmaKnownEvent[];
}) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let cleanedUp = false;
      let unsubscribe: (() => void) | null = null;

      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        clearInterval(keepalive);
        unsubscribe?.();
        unsubscribe = null;
      };
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onEvent = (event: EmaKnownEvent) => {
        if (filter(event)) {
          send(encodeSse(event));
        }
      };
      const keepalive = setInterval(() => {
        send(`: keepalive ${Date.now()}\n\n`);
      }, KEEPALIVE_INTERVAL_MS);

      unsubscribe = subscribe(onEvent);
      send(`: connected ${Date.now()}\n\n`);
      for (const event of initialEvents) {
        onEvent(event);
      }
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });
}

export function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function parseTopicParam(value: string | null): EmaEventTopic[] | null {
  if (!value) {
    return null;
  }
  return value
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean) as EmaEventTopic[];
}
