import { buildActorSettingsResponse } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  return Response.json(await buildActorSettingsResponse(actorId), {
    status: 200,
  });
}
