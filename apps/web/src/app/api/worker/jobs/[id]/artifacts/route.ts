import { NextResponse } from "next/server";
import { MediaKindSchema } from "@kylosonic/opencontext-schemas";
import { storeArtifact } from "@/server/worker";
import {
  checkClaim,
  enforceRateLimit,
  errorResponse,
  verifyWorkerToken,
  withErrorHandling,
  workerIdOf,
} from "@/server/api-helpers";
import { RATE_LIMITS } from "@/server/security/rate-limit";

export const runtime = "nodejs";
const MAX_ARTIFACT_MULTIPART_BYTES = 64 * 1024 * 1024 + 64 * 1024;
const ARTIFACT_EXTENSIONS = {
  AUDIO: new Set(["flac", "m4a", "mp3", "ogg", "wav"]),
  FRAME: new Set(["jpeg", "jpg", "png", "webp"]),
} as const;

/**
 * POST /api/worker/jobs/[id]/artifacts — multipart binary upload (audio,
 * frames). Fields: `file` (required), `kind` (SOURCE|AUDIO|FRAME),
 * `timestampSec` (frames). Stores the object and registers a Media row
 * (references only, ADR-0004). The route caps the wire stream even when a
 * proxy omits or understates Content-Length. Response: {key, id}.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { id } = await context.params;
    const workerId = workerIdOf(request);

    const claim = await checkClaim(id, workerId);
    if (claim.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (claim.kind === "NOT_CLAIMED") {
      return errorResponse("VALIDATION_ERROR", "Job is not claimed by this worker");
    }
    const limited = await enforceRateLimit(
      `worker-artifact:${workerId}`,
      RATE_LIMITS.workerMutation.limit,
      RATE_LIMITS.workerMutation.windowMs,
    );
    if (limited) return limited;
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data(?:;|$)/i.test(contentType.trim())) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Artifact upload must use multipart/form-data",
      );
    }

    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = Number(contentLengthHeader ?? "0");
    if (
      contentLengthHeader !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength <= 0)
    ) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Artifact Content-Length is invalid",
      );
    }
    if (contentLength > MAX_ARTIFACT_MULTIPART_BYTES) {
      return errorResponse("VALIDATION_ERROR", "Artifact upload is too large");
    }

    if (!request.body) {
      return errorResponse("VALIDATION_ERROR", "Artifact upload body is missing");
    }

    let bytesRead = 0;
    const boundedBody = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          if (bytesRead > MAX_ARTIFACT_MULTIPART_BYTES) {
            controller.error(new Error("ARTIFACT_TOO_LARGE"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );

    let form: FormData;
    try {
      form = await new Response(boundedBody, {
        headers: { "Content-Type": contentType },
      }).formData();
    } catch (error) {
      if (error instanceof Error && error.message === "ARTIFACT_TOO_LARGE") {
        return errorResponse("VALIDATION_ERROR", "Artifact upload is too large");
      }
      return errorResponse(
        "VALIDATION_ERROR",
        "Request body must be multipart/form-data with a `file` field",
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return errorResponse("VALIDATION_ERROR", "Missing `file` field");
    }
    if (file.size <= 0 || file.size > 64 * 1024 * 1024) {
      return errorResponse("VALIDATION_ERROR", "Artifact size is invalid");
    }

    const kindParsed = MediaKindSchema.safeParse(String(form.get("kind") ?? ""));
    if (!kindParsed.success || kindParsed.data === "SOURCE") {
      return errorResponse("VALIDATION_ERROR", "`kind` must be AUDIO or FRAME");
    }
    const extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
    if (
      file.name.lastIndexOf(".") < 0 ||
      !ARTIFACT_EXTENSIONS[kindParsed.data].has(extension)
    ) {
      return errorResponse(
        "VALIDATION_ERROR",
        `Artifact extension is not valid for ${kindParsed.data}`,
      );
    }

    const timestampRaw = form.get("timestampSec");
    const timestampSec =
      timestampRaw === null || timestampRaw === "" ? undefined : Number(timestampRaw);
    if (timestampSec !== undefined && !Number.isFinite(timestampSec)) {
      return errorResponse("VALIDATION_ERROR", "`timestampSec` must be numeric");
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
