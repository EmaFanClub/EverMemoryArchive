import {
  deleteActorQqConversationService,
  patchActorQqConversationService,
} from "@/server/services/dashboard";
import type { ActorQQConversationPatchRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ actorId: string; conversationId: string }> },
) {
  const { actorId, conversationId } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<ActorQQConversationPatchRequest>;
  const result = await patchActorQqConversationService(
    actorId,
    conversationId,
    body,
  );
  return Response.json(result, { status: result.ok ? 200 : 400 });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ actorId: string; conversationId: string }> },
) {
  const { actorId, conversationId } = await context.params;
  const result = await deleteActorQqConversationService(
    actorId,
    conversationId,
  );
  return Response.json(result, { status: result.ok ? 200 : 404 });
}
