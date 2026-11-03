import { NextResponse } from "next/server";
import { retentionSweep } from "@/server/queue";
import { errorResponse, verifyWorkerToken, withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";

/**
 * POST /api/admin/retention-sweep — manual retention trigger (jobs.md
 * B9; worker token). Completed jobs expire 14 days after completion;
 * unfinished jobs 7 days after creation. Idempotent: returns counts.
 */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const result = await retentionSweep();
    return NextResponse.json(result);
  });
}
