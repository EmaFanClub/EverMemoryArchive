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
    const status = message.includes("not found") ? 404 : 400;
    return Response.json(
      {
        message: message || "Failed to delete actor.",
      },
      { status },
    );
  }
}
