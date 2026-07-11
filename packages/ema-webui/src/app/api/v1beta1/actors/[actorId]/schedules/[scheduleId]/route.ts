import {
  deleteActorScheduleService,
  patchActorScheduleService,
} from "@/server/services/actor-schedule-memory";
import type { ActorSchedulePatchRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ actorId: string; scheduleId: string }> },
) {
  const { actorId, scheduleId } = await params;
  const body = ((await request.json().catch(() => ({}))) ??
    {}) as ActorSchedulePatchRequest;
  const result = await patchActorScheduleService(actorId, scheduleId, body);
  return Response.json(result, { status: actorScheduleMutationStatus(result) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ actorId: string; scheduleId: string }> },
) {
  const { actorId, scheduleId } = await params;
  const result = await deleteActorScheduleService(actorId, scheduleId);
  return Response.json(result, { status: actorScheduleMutationStatus(result) });
}

export function actorScheduleMutationStatus(result: {
  ok: boolean;
  error?: { code: string };
}): number {
  if (result.ok) return 200;
  if (result.error?.code === "SCHEDULE_NOT_FOUND") return 404;
  if (
    result.error?.code === "SCHEDULE_UPDATE_FAILED" ||
    result.error?.code === "SCHEDULE_DELETE_FAILED"
  ) {
    return 500;
  }
  return 400;
}
