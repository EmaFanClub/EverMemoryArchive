import "server-only";

export const ACCESS_TOKEN_COOKIE = "ema_access_token";
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export function isAccessTokenValid(token: string) {
  return token.trim().length > 0;
}

export function createAccessTokenRecord(token: string) {
  return {
    accessToken: token.trim(),
  };
}

export function hasAccessTokenConfig(system: { accessToken?: string }) {
  return Boolean(system.accessToken?.trim());
}

export function verifyAccessToken(
  token: string,
  system: {
    accessToken?: string;
  },
) {
  if (!isAccessTokenValid(token) || !hasAccessTokenConfig(system)) {
    return false;
  }
  return token.trim() === system.accessToken!.trim();
}

export function readAccessTokenCookie(request: Request) {
  return readCookie(request.headers.get("cookie") ?? "", ACCESS_TOKEN_COOKIE);
}

export function createAccessTokenCookie(token: string, requestUrl: string) {
  const secure = new URL(requestUrl).protocol === "https:";
  return [
    `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token.trim())}`,
    `Max-Age=${ACCESS_TOKEN_TTL_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function readCookie(header: string, name: string) {
  for (const item of header.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return "";
      }
    }
  }
  return "";
}
