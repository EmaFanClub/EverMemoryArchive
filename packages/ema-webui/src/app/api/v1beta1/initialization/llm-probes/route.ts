import { runSetupServiceCheck } from "@/server/services/setup";
import type { SetupServiceCheckRequest } from "@/types/setup/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as SetupServiceCheckRequest;
  const result = await runSetupServiceCheck("llm", body);
  return Response.json(result, { status: 200 });
}
