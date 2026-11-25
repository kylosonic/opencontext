import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { safeMutation } from "@/server/security/request-origin";

/**
 * Route protection (identity.md B1/B4/B5):
 * - /app/**          → session required; anonymous visitors are sent to
 *                      /auth/signin with a callbackUrl back to where they
 *                      were going.
 * - /api/jobs/** and /api/workspaces/** → session required; anonymous callers get a 401 JSON
 *                      error envelope (the API never renders sign-in UI).
 * - everything else (/api/demo/**, /api/worker/**, /api/admin/**,
 *   /auth/**, landing, docs) is open or authenticated by its own layer.
 */
const { auth } = NextAuth(authConfig);

export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;

  // Auth.js may normalize nextUrl to its internal bind host inside a
  // container. The incoming Host header is the value browser Origin must
  // match; forwarded hosts are still ignored unless proxy trust is explicit.
  const requestHost = req.headers.get("host") || req.nextUrl.host;
  if (!safeMutation(req.method, req.headers, requestHost)) {
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
  matcher: [
    "/app/:path*",
    "/api/jobs/:path*",
    "/api/uploads/:path*",
    "/api/workspaces/:path*",
    "/api/invites/:path*",
    "/api/imports/:path*",
    "/api/usage",
    "/api/usage/:path*",
  ],
};
