import { startActorTrainingService } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const result = await startActorTrainingService(actorId);
  return Response.json(result, { status: 200 });
}
