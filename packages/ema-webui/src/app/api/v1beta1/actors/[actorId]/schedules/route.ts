import { buildActorScheduleListResponse } from "@/server/services/actor-schedule-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await params;
  try {
    return Response.json(await buildActorScheduleListResponse(actorId), {
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { message: message || "Failed to load actor schedules." },
      { status: actorScheduleRouteErrorStatus(message) },
    );
  }
}

export function actorScheduleRouteErrorStatus(message: string): number {
  if (message.startsWith("Invalid actor id:")) {
    return 400;
  }
  if (message.includes("not found")) {
    return 404;
  }
  return 500;
}
