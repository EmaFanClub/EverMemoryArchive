import { runGlobalEmbeddingServiceCheck } from "@/server/services/dashboard";
import type { GlobalEmbeddingCheckRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as GlobalEmbeddingCheckRequest;
  const result = await runGlobalEmbeddingServiceCheck(body);
  return Response.json(result, { status: 200 });
}
