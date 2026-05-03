import {
  buildChatHistory,
  getDefaultWebSession,
  sendConversationMessage,
} from "@/server/services/chat";
import type { SendMessageRequest } from "@/types/chat/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  const { actorId, session } = await context.params;
  const url = new URL(request.url);
  const limit = parseOptionalInteger(url.searchParams.get("limit"));
  const beforeMsgId = parseOptionalInteger(url.searchParams.get("beforeMsgId"));

  const history = await buildChatHistory({
    actorId,
    session,
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof beforeMsgId === "number" ? { beforeMsgId } : {}),
  });

  return Response.json(history, { status: 200 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  const { actorId, session } = await context.params;
  if (session !== getDefaultWebSession()) {
    return Response.json(
      { message: `Conversation ${session} not found.` },
      { status: 404 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as SendMessageRequest;
  const result = await sendConversationMessage({
    actorId,
    request: body,
  });
  return Response.json(result, { status: 200 });
}

function parseOptionalInteger(value: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}
