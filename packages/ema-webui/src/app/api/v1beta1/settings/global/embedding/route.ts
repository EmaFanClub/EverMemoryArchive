import { saveGlobalEmbeddingServiceConfig } from "@/server/services/dashboard";
import type { GlobalEmbeddingSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as GlobalEmbeddingSaveRequest;
  const result = await saveGlobalEmbeddingServiceConfig(body);
  return Response.json(result, { status: 200 });
}
