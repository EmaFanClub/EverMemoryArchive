import { buildActorTokenUsageResponse } from "@/server/services/actor-token-usage";
import {
  isTokenUsageRange,
  type TokenUsageRange,
} from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ actorId: string }> },
) {
  const { actorId } = await context.params;
  const rangeParam = new URL(request.url).searchParams.get("range") ?? "today";
  if (!isTokenUsageRange(rangeParam)) {
    return Response.json(
      {
        message: `Invalid token usage range: ${rangeParam}`,
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(
      await buildActorTokenUsageResponse(
        actorId,
        rangeParam as TokenUsageRange,
      ),
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      {
        message: message || "Failed to load actor token usage.",
      },
      { status: actorTokenUsageErrorStatus(message) },
    );
  }
}

export function actorTokenUsageErrorStatus(message: string): number {
  if (message.startsWith("Invalid actor id:")) {
    return 400;
  }
  if (message.includes("not found")) {
    return 404;
  }
  return 500;
}
