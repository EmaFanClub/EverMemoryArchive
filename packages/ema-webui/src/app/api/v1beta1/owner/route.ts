import { buildOwnerResponse } from "@/server/services/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await buildOwnerResponse(), { status: 200 });
}
