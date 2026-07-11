import {
  deleteActorMemoryService,
  patchActorMemoryService,
} from "@/server/services/actor-schedule-memory";
import type { ActorMemoryPatchRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ actorId: string; memoryId: string }> },
) {
  const { actorId, memoryId } = await params;
  const body = ((await request.json().catch(() => ({}))) ??
    {}) as ActorMemoryPatchRequest;
  const result = await patchActorMemoryService(actorId, memoryId, body);
  return Response.json(result, { status: actorMemoryMutationStatus(result) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ actorId: string; memoryId: string }> },
) {
  const { actorId, memoryId } = await params;
  const result = await deleteActorMemoryService(actorId, memoryId);
  return Response.json(result, { status: actorMemoryMutationStatus(result) });
}

export function actorMemoryMutationStatus(result: {
  ok: boolean;
  error?: { code: string };
}): number {
  if (result.ok) return 200;
  if (result.error?.code === "MEMORY_NOT_FOUND") return 404;
  if (
    result.error?.code === "MEMORY_UPDATE_FAILED" ||
    result.error?.code === "MEMORY_DELETE_FAILED"
  ) {
    return 500;
  }
  return 400;
}
