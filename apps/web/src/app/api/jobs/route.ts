import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listJobs } from "@/server/jobs";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";

/**
 * GET /api/jobs — the caller's own jobs, newest first.
 *
 * Uploads use POST /api/uploads, a direct object-storage PUT, and
 * POST /api/uploads/[id]/complete so large bytes never pass through the
 * Next.js request body.
 */
export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const jobs = await listJobs(session.user.id);
    return NextResponse.json(jobs);
  });
}
