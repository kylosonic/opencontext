import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { cancelUpload } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/uploads/[id] - abort an upload and remove its temporary object. */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(`upload-cancel:${session.user.id}`, 30, 60_000);
    if (!limit.allowed) {
      const response = errorResponse("RATE_LIMITED", "Too many upload cancellations");
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }

    const { id } = await context.params;
    const result = await cancelUpload(id, session.user.id);
    switch (result.kind) {
      case "NOT_FOUND":
        return errorResponse("NOT_FOUND", "Upload intent not found");
      case "FORBIDDEN":
        return errorResponse("FORBIDDEN", "You don't have access to this upload");
      case "OK":
        return new NextResponse(null, { status: 204 });
    }
  });
}
