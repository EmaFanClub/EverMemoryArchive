import {
  createActorQqConversationService,
  listActorQqConversationsService,
} from "@/server/services/dashboard";
import type { ActorQQConversationCreateRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  return Response.json(await listActorQqConversationsService(actorId), {
    status: 200,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<ActorQQConversationCreateRequest>;
  const result = await createActorQqConversationService(actorId, body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
