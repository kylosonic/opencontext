import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { DetailLevelSchema, UPLOAD_LIMITS } from "@opencontext/schemas";
import { auth } from "@/auth";
import { createJob, jobToSummary } from "@/server/jobs";
import { listJobs } from "@/server/jobs";
import { storage } from "@/server/storage";
import { sanitizeDisplayName, validateUpload } from "@/server/validation/upload";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";

class UploadTooLargeError extends Error {}

/**
 * POST /api/jobs — multipart upload + job creation in one request
 * (blueprint §2 combined endpoint; ADR-0002 server-side upload).
 * Body: multipart/form-data with `file` (required) and `detailLevel`
 * (optional, LOW|MEDIUM|HIGH, default MEDIUM).
 *
 * Commit sequence (blueprint §3 B3): validate → stream to a temp key
 * while counting bytes → create Job + SOURCE Media and move the temp
 * object to its final key in one transaction. Any failure removes the
 * temp object and rolls the rows back — partial data never enters
 * processing.
 */
export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > UPLOAD_LIMITS.maxBytes) {
      return errorResponse(
        "FILE_TOO_LARGE",
        "File is too large — the limit is 500 MB",
      );
    }

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

    const detailRaw = form.get("detailLevel");
    const detailParsed = DetailLevelSchema.safeParse(
      detailRaw === null ? "MEDIUM" : String(detailRaw),
    );
    const detailLevel = detailParsed.success ? detailParsed.data : "MEDIUM";

    const validation = validateUpload(file.name, file.size);
    if (!validation.ok) {
      return errorResponse(validation.code, validation.message);
    }

    const tempKey = `incoming/${randomUUID()}`;
    try {
      let received = 0;
      const guarded = file.stream().pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (received > UPLOAD_LIMITS.maxBytes) {
              controller.error(new UploadTooLargeError());
            } else {
              controller.enqueue(chunk);
            }
          },
        }),
      );
      await storage.put(tempKey, guarded, {
        sizeBytes: file.size,
        contentType: file.type || undefined,
      });
    } catch (error) {
      await storage.delete(tempKey).catch(() => undefined);
      if (error instanceof UploadTooLargeError) {
        return errorResponse(
          "FILE_TOO_LARGE",
          "File is too large — the limit is 500 MB",
        );
      }
      return errorResponse("INTERNAL", "Upload failed — please try again");
    }

    try {
      const job = await createJob({
        userId: session.user.id,
        displayName: sanitizeDisplayName(file.name),
        detailLevel,
        sourceExt: validation.extension,
        sourceSize: file.size,
        sourceMime: file.type || "application/octet-stream",
        tempKey,
      });
      return NextResponse.json(jobToSummary(job), { status: 201 });
    } catch (error) {
      console.error("Job creation failed:", error);
      return errorResponse("INTERNAL", "Could not create the job");
    }
  });
}

/**
 * GET /api/jobs — the caller's own jobs, newest first (jobs.md B8).
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
