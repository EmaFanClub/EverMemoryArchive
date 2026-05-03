import { toWebBusEvent } from "@/server/ema-adapter/events";
import { ensureEmaServer } from "@/server/ema-server";
import {
  createSubscribedSseStream,
  parseTopicParam,
  sseResponse,
} from "@/server/events/sse";
import { eventMatchesTopics } from "@/server/events/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const server = await ensureEmaServer();
  const url = new URL(request.url);
  const topics = parseTopicParam(url.searchParams.get("topics"));
  return sseResponse(
    createSubscribedSseStream({
      request,
      filter: (event) =>
        event.type !== "conversation.message.created" &&
        event.type !== "conversation.typing.changed" &&
        eventMatchesTopics(event, topics),
      subscribe: (handler) =>
        server.bus.subscribe((event) => {
          const webEvent = toWebBusEvent(event);
          if (
            !webEvent ||
            webEvent.type === "conversation.message.created" ||
            webEvent.type === "conversation.typing.changed"
          ) {
            return;
          }
          handler(webEvent);
        }),
    }),
  );
}
