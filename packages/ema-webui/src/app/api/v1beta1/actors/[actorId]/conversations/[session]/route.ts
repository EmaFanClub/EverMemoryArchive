import {
  buildActorConversationResponse,
  patchActorConversationService,
  saveActorConversationService,
} from "@/server/services/dashboard";
import type {
  ActorConversationPatchRequest,
  ActorConversationSaveRequest,
} from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  const { actorId, session } = await context.params;
  try {
    return Response.json(
      await buildActorConversationResponse(actorId, session),
      {
        status: 200,
      },
    );
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof Error ? error.message : "Conversation not found.",
      },
      { status: 404 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  const { actorId, session } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<ActorConversationSaveRequest>;
  const result = await saveActorConversationService(actorId, session, body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ actorId: string; session: string }> },
) {
  const { actorId, session } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<ActorConversationPatchRequest>;
  const result = await patchActorConversationService(actorId, session, body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
