import { UPLOAD_LIMITS, type ErrorCode } from "@opencontext/schemas";

/**
 * Server-side upload validation (upload.md B1 + blueprint §3). The client
 * pre-validates for instant feedback; this is the authoritative gate.
 * Named reasons: FILE_TOO_LARGE, FORMAT_UNSUPPORTED, VALIDATION_ERROR.
 */

export type UploadValidation =
  | { ok: true; extension: string; mime: string }
  | { ok: false; code: ErrorCode; message: string };

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

export function validateUpload(
  filename: string,
  sizeBytes: number,
  mime?: string | null,
): UploadValidation {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "File size is invalid",
    };
  }
  if (sizeBytes === 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "The file is empty",
    };
  }
  if (sizeBytes > UPLOAD_LIMITS.maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "File is too large — the limit is 500 MB",
    };
  }
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: "This format is not supported — use MP4, MOV, WebM, or MKV",
    };
  }
  const extension = filename.slice(dot).toLowerCase();
  if (!(UPLOAD_LIMITS.allowedExtensions as readonly string[]).includes(extension)) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: "This format is not supported — use MP4, MOV, WebM, or MKV",
    };
  }
  const normalizedExtension = extension.slice(1);
  const inferredMime = MIME_BY_EXTENSION[normalizedExtension];
  const normalizedMime = mime?.trim().toLowerCase() || inferredMime;
  if (
    !normalizedMime ||
    !(UPLOAD_LIMITS.allowedMimeTypes as readonly string[]).includes(normalizedMime)
  ) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: "This file does not have a supported video media type",
    };
  }
  if (normalizedMime !== inferredMime) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: "The file extension and media type do not match",
    };
  }
  return { ok: true, extension: normalizedExtension, mime: normalizedMime };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_DISPLAY_NAME = 255;

/**
 * Job display name (upload.md B6): strip path separators and control
 * characters, keep the rest verbatim. Rendered as text only by the UI —
 * never interpreted as a path or executed.
 */
export function sanitizeDisplayName(filename: string): string {
  const cleaned = filename
    .replaceAll("\\", "")
    .replaceAll("/", "")
    .replace(CONTROL_CHARS, "")
    .slice(0, MAX_DISPLAY_NAME);
  return cleaned.trim() === "" ? "video" : cleaned;
}
