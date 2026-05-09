import { deleteActorService } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await params;
  try {
    const result = await deleteActorService(actorId);
    return Response.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = actorDeleteErrorStatus(message);
    return Response.json(
      {
        message: message || "Failed to delete actor.",
      },
      { status },
    );
  }
}

export function actorDeleteErrorStatus(message: string): number {
  if (message.startsWith("Invalid actor id:")) {
    return 400;
  }
  if (message.includes("not found")) {
    return 404;
  }
  if (
    message === "Actor is training." ||
    message === "Actor is transitioning."
  ) {
    return 409;
  }
  return 500;
}
