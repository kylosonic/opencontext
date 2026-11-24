import { contentTypeForExtension } from "@/lib/media-formats";
import { storage } from "@/server/storage";
import {
  enforceRateLimit,
  errorResponse,
  verifyWorkerToken,
  withErrorHandling,
  workerIdOf,
} from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { RATE_LIMITS } from "@/server/security/rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/worker/media/[...key] — stream a local object only when the
 * requesting worker has a live claim on a job that owns the key. S3
 * deployments use signed object URLs instead.
 */
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    if (storage.provider !== "local") {
      return errorResponse("NOT_FOUND", "Media object not found");
    }
    const workerId = workerIdOf(request);
    if (!workerId) {
      return errorResponse("WORKER_UNAUTHORIZED", "Missing x-worker-id header");
    }
    const limited = await enforceRateLimit(
      `worker-media:${workerId}`,
      RATE_LIMITS.workerMedia.limit,
      RATE_LIMITS.workerMedia.windowMs,
    );
    if (limited) return limited;
    const { key: segments } = await context.params;
    const key = segments.join("/");
    const owner = await prisma.job.findFirst({
      where: {
        claimedBy: workerId,
        leaseUntil: { gt: new Date() },
        OR: [{ sourceKey: key }, { media: { some: { key } } }],
      },
      select: { id: true },
    });
    if (!owner) {
      // Match an absent object so a valid token cannot enumerate keys.
      return errorResponse("NOT_FOUND", "Media object not found");
    }
    const body = await storage.stream(key);
    if (body === null) {
      return errorResponse("NOT_FOUND", "Media object not found");
    }

    const dot = key.lastIndexOf(".");
    const extension = (dot >= 0 ? key.slice(dot + 1) : "").toLowerCase();
    return new Response(body, {
      headers: {
        "Content-Type":
          contentTypeForExtension(extension) ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
