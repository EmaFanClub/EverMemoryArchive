import { buildSetupStatus, commitSetupDraft } from "@/server/services/setup";
import { createAccessTokenCookie } from "@/server/services/access-token";
import type { SetupCommitRequest } from "@/types/setup/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await buildSetupStatus(), { status: 200 });
}

export async function PUT(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<SetupCommitRequest>;
  if (!body.draft) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_CONFIG",
          retryable: true,
          details: { issuePaths: ["draft"] },
        },
      },
      { status: 400 },
    );
  }

  const result = await commitSetupDraft(body.draft);
  const response = Response.json(result, { status: result.ok ? 200 : 400 });
  if (result.ok) {
    response.headers.append(
      "Set-Cookie",
      createAccessTokenCookie(body.draft.owner.accessToken, request.url),
    );
  }
  return response;
}
