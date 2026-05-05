import { NextResponse, type NextRequest } from "next/server";
import type { SetupStatusResponse } from "@/types/setup/v1beta1";

export const config = {
  matcher: ["/((?!_next/|.*\\..*).*)"],
};

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const isSetupStatusApi =
    pathname === "/api/v1beta1/initialization" && request.method === "GET";
  const isInitializationApi = pathname.startsWith(
    "/api/v1beta1/initialization",
  );
  const isAuthSessionApi = pathname === "/api/v1beta1/auth/session";

  if (isSetupStatusApi || isAuthSessionApi) {
    return NextResponse.next();
  }

  const ownerReady = await getOwnerReady(request);

  if (!ownerReady) {
    if (pathname === "/setup" || isInitializationApi) {
      return NextResponse.next();
    }
    if (isApi) {
      return unauthorized();
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  const authenticated = await getAuthenticated(request);
  if (!authenticated) {
    if (pathname === "/login") {
      return NextResponse.next();
    }
    if (isApi) {
      return unauthorized();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/" || pathname === "/setup" || pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

async function getAuthenticated(request: NextRequest) {
  try {
    const response = await fetch(
      new URL("/api/v1beta1/auth/session", request.url),
      {
        cache: "no-store",
        headers: {
          cookie: request.headers.get("cookie") ?? "",
        },
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Access token is required.",
      },
    },
    { status: 401 },
  );
}

async function getOwnerReady(request: NextRequest) {
  try {
    const response = await fetch(
      new URL("/api/v1beta1/initialization", request.url),
      { cache: "no-store" },
    );
    if (!response.ok) {
      return false;
    }
    const status = (await response.json()) as SetupStatusResponse;
    return !status.needsInitialization;
  } catch {
    return false;
  }
}
