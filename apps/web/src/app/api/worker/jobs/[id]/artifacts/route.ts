import { NextResponse } from "next/server";
import { MediaKindSchema } from "@opencontext/schemas";
import { storeArtifact } from "@/server/worker";
import {
  checkClaim,
  errorResponse,
  verifyWorkerToken,
  withErrorHandling,
  workerIdOf,
} from "@/server/api-helpers";

export const runtime = "nodejs";

/**
 * POST /api/worker/jobs/[id]/artifacts — multipart binary upload (audio,
 * frames). Fields: `file` (required), `kind` (SOURCE|AUDIO|FRAME),
 * `timestampSec` (frames). Stores the object and registers a Media row
 * (references only, ADR-0004). Key is deterministic per
 * (kind, timestampSec) so re-uploads are idempotent. Response: {key, id}.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { id } = await context.params;
    const workerId = workerIdOf(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse(
        "VALIDATION_ERROR",
        "Request body must be multipart/form-data with a `file` field",
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse("VALIDATION_ERROR", "Missing `file` field");
    }

    const kindParsed = MediaKindSchema.safeParse(String(form.get("kind") ?? ""));
    if (!kindParsed.success || kindParsed.data === "SOURCE") {
      return errorResponse("VALIDATION_ERROR", "`kind` must be AUDIO or FRAME");
    }

    const timestampRaw = form.get("timestampSec");
    const timestampSec =
      timestampRaw === null || timestampRaw === "" ? undefined : Number(timestampRaw);
    if (timestampSec !== undefined && !Number.isFinite(timestampSec)) {
      return errorResponse("VALIDATION_ERROR", "`timestampSec` must be numeric");
    }

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }

    const stored = await storeArtifact(claim.job, {
      kind: kindParsed.data,
      timestampSec,
      filename: file.name,
      mime: file.type || undefined,
      sizeBytes: file.size,
      body: file.stream(),
    });
    return NextResponse.json({ key: stored.key, id: stored.mediaId }, { status: 201 });
  });
}
