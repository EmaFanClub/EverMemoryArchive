import { buildGlobalSettingsResponse } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await buildGlobalSettingsResponse(), { status: 200 });
}
