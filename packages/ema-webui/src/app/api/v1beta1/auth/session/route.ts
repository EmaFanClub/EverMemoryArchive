import {
  createAccessTokenCookie,
  readAccessTokenCookie,
  verifyAccessToken,
} from "@/server/services/access-token";
import { ensureEmaServer } from "@/server/ema-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ok = await verifyRequestToken(request);
  return Response.json(
    { apiVersion: "v1beta1", ok },
    { status: ok ? 200 : 401 },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown;
  };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const ok = await verifyRequestToken(request, token);
  if (!ok) {
    return Response.json(
      {
        apiVersion: "v1beta1",
        ok: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Token 不正确。",
        },
      },
      { status: 401 },
    );
  }

  const response = Response.json(
    { apiVersion: "v1beta1", ok: true },
    { status: 200 },
  );
  response.headers.append(
    "Set-Cookie",
    createAccessTokenCookie(token, request.url),
  );
  return response;
}

async function verifyRequestToken(request: Request, token?: string) {
  const server = await ensureEmaServer();
  const record = await server.dbService.globalConfigDB.getGlobalConfig();
  if (!record) {
    return false;
  }
  return verifyAccessToken(
    token ?? readAccessTokenCookie(request),
    record.system,
  );
}
