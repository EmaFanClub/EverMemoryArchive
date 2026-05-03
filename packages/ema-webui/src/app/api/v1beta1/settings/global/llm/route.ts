import { saveGlobalLlmServiceConfig } from "@/server/services/dashboard";
import type { GlobalLlmSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GlobalLlmSaveRequest;
  const result = await saveGlobalLlmServiceConfig(body);
  return Response.json(result, { status: 200 });
}
