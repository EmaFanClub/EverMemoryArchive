import { buildDryRunResponse } from "@/server/services/setup";
import { initialDraft, type SetupDryRunRequest } from "@/types/setup/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<SetupDryRunRequest>;
  const result = buildDryRunResponse(body.draft ?? initialDraft);
  return Response.json(result, { status: 200 });
}
