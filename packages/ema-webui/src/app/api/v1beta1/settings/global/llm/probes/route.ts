import { runGlobalLlmServiceCheck } from "@/server/services/dashboard";
import type { GlobalLlmCheckRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as GlobalLlmCheckRequest;
  const result = await runGlobalLlmServiceCheck(body);
  return Response.json(result, { status: 200 });
}
