import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

/**
 * Route protection (identity.md B1/B4/B5):
 * - /app/**          → session required; anonymous visitors are sent to
 *                      /auth/signin with a callbackUrl back to where they
 *                      were going.
 * - /api/jobs/**     → session required; anonymous callers get a 401 JSON
 *                      error envelope (the API never renders sign-in UI).
 * - everything else (/api/demo/**, /api/worker/**, /api/admin/**,
 *   /auth/**, landing, docs) is open or authenticated by its own layer.
 */
const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;

  if (!safeMutation(req.method, req.headers, req.nextUrl.host)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Cross-site request rejected" } },
      { status: 403 },
    );
  }

  if (!req.auth) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
        { status: 401 },
      );
    }
    const callbackUrl = `${pathname}${search}`;
    const signInUrl = new URL("/auth/signin", req.nextUrl);
    signInUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/app/:path*", "/api/jobs/:path*", "/api/uploads/:path*"],
};

/** Browser mutations must be same-origin; non-browser clients omit these headers. */
export function safeMutation(
  method: string,
  headers: Headers,
  requestHost: string,
): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    return true;
  }
  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = headers.get("origin");
  if (!origin) return true;
  try {
    const expectedHost =
      headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || requestHost;
    return new URL(origin).host.toLowerCase() === expectedHost.toLowerCase();
  } catch {
    return false;
  }
}
