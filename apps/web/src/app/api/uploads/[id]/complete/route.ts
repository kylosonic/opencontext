import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { jobToSummary } from "@/server/jobs";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { completeUpload } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/uploads/[id]/complete — verify the object and create the job. */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = consumeRateLimit(`upload-complete:${session.user.id}`, 20, 60_000);
    if (!limit.allowed) {
      const response = errorResponse("RATE_LIMITED", "Too many upload completions");
      response.headers.set("Retry-After", String(limit.retryAfterSec));
      return response;
    }

    const { id } = await context.params;
    const result = await completeUpload(id, session.user.id);
    switch (result.kind) {
      case "NOT_FOUND":
        return errorResponse("NOT_FOUND", "Upload intent not found");
      case "FORBIDDEN":
        return errorResponse("FORBIDDEN", "You don't have access to this upload");
      case "EXPIRED":
        return errorResponse("UPLOAD_EXPIRED", "Upload intent has expired");
      case "INCOMPLETE":
        return errorResponse(
          "UPLOAD_INCOMPLETE",
          "The uploaded object is missing or does not match the declared file",
        );
      case "OK":
        return NextResponse.json(jobToSummary(result.job), { status: 201 });
    }
  });
}
