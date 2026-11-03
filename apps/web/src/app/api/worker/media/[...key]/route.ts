import { storage } from "@/server/storage";
import { errorResponse, verifyWorkerToken, withErrorHandling } from "@/server/api-helpers";

export const runtime = "nodejs";

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  aac: "audio/aac",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

/**
 * GET /api/worker/media/[...key] — stream a stored object (worker token
 * required). Used for local-disk source fetches (worker source info
 * returns `/api/worker/media/<key>`); S3 deployments use presigned URLs
 * instead.
 */
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return withErrorHandling(async () => {
    if (!verifyWorkerToken(request)) {
      return errorResponse("WORKER_UNAUTHORIZED", "Invalid or missing worker token");
    }
    const { key: segments } = await context.params;
    const key = segments.join("/");
    const body = await storage.stream(key);
    if (body === null) {
      return errorResponse("NOT_FOUND", "Media object not found");
    }

    const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    return new Response(body, {
      headers: {
        "Content-Type": MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  });
}
