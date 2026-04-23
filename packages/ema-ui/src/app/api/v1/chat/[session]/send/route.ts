import { buildSession, resolveSession, type ChannelChatEvent } from "ema";
import { getServer } from "@/server";

interface ChatSendRequest {
  userId: number;
  actorId: number;
  uid: string;
  name: string;
  text: string;
  replyMsgId?: number;
  time?: number;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ session: string }> },
) {
  const body = (await request.json()) as ChatSendRequest;
  const { session: rawSession } = await context.params;
  const session = resolveSession(rawSession)
    ? rawSession
    : buildSession("web", "chat", rawSession);

  const server = await getServer();
  const conversation = await server.dbService.getConversationBySession(
    body.actorId,
    session,
  );
  if (!conversation || typeof conversation.id !== "number") {
    return new Response(
      JSON.stringify({ ok: false, msg: "Conversation not found.", session }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const event: ChannelChatEvent = {
    kind: "chat",
    channel: "web",
    session,
    speaker: {
      session,
      uid: body.uid,
      name: body.name,
    },
    channelMessageId: "web:pending",
    ...(typeof body.replyMsgId === "number"
      ? {
          replyTo: {
            kind: "msg" as const,
            msgId: body.replyMsgId,
          },
        }
      : {}),
    inputs: [{ type: "text", text: body.text }],
    time: body.time,
  };

  const result = await server.gateway.dispatchChannel(body.actorId, event);

  return new Response(JSON.stringify({ ...result, session }), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}
