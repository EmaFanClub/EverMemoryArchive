import { buildSession, resolveSession } from "ema";
import { getServer } from "../../../../shared-server";

const DEFAULT_ACTOR_ID = 1;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ session: string }> },
) {
  const { session: rawSession } = await context.params;
  const session = resolveSession(rawSession)
    ? rawSession
    : buildSession("web", "chat", rawSession);
  const server = await getServer();
  const conversation = await server.dbService.getConversationBySession(
    DEFAULT_ACTOR_ID,
    session,
  );
  if (!conversation) {
    return new Response(JSON.stringify({ error: "Conversation not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const conversationId = conversation.id!;
  const channel = server.gateway.channelRegistry.webChannel;
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            kind: "ready",
            actorId: DEFAULT_ACTOR_ID,
            conversationId,
            session,
          })}\n\n`,
        ),
      );
      unsubscribe = channel.subscribe(conversationId, (response) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(response)}\n\n`),
        );
      });
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      Connection: "keep-alive",
      "Content-Encoding": "none",
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
