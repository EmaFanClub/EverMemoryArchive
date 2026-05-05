import { createAccessTokenCookie } from "@/server/services/access-token";
import { saveGlobalAccessTokenService } from "@/server/services/dashboard";
import type { GlobalAccessTokenSaveRequest } from "@/types/dashboard/v1beta1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as GlobalAccessTokenSaveRequest;
  const result = await saveGlobalAccessTokenService(body);
  const response = Response.json(result, { status: result.ok ? 200 : 400 });
  if (result.ok) {
    const token = typeof body.token === "string" ? body.token : "";
    response.headers.append(
      "Set-Cookie",
      createAccessTokenCookie(token, request.url),
    );
  }
  return response;
}
