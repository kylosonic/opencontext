import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { storage } from "@/server/storage";
import { getUploadIntent, storeLocalUpload } from "@/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PUT /api/uploads/[id]/body — local-development upload sink. S3 uploads
 * go directly to the presigned object-storage URL instead.
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    if (storage.provider !== "local") {
      return errorResponse(
        "VALIDATION_ERROR",
        "This upload must use its presigned object-storage URL",
      );
    }

    const { id } = await context.params;
    const lookup = await getUploadIntent(id, session.user.id);
    if (lookup.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Upload intent not found");
    }
    if (lookup.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this upload");
    }
    if (lookup.kind === "EXPIRED") {
      return errorResponse("UPLOAD_EXPIRED", "Upload intent has expired");
    }
    if (!request.body) {
      return errorResponse("VALIDATION_ERROR", "Upload body is empty");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > lookup.intent.sizeBytes) {
      return errorResponse("FILE_TOO_LARGE", "Upload is larger than declared");
    }
    const result = await storeLocalUpload(
      lookup.intent,
      request.body,
      request.headers.get("content-type"),
    );
    if (result !== "OK") {
      return errorResponse(
        "UPLOAD_INCOMPLETE",
        "Upload size or media type did not match the declared file",
      );
    }
    return new NextResponse(null, { status: 204 });
  });
}
