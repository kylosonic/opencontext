/**
 * Client-side pre-flight checks for the upload form (upload.md B1).
 *
 * The SERVER validation (`src/server/validation/upload.ts`, driven by
 * `@kylosonic/opencontext-schemas` UPLOAD_LIMITS) is authoritative — the 4xx error
 * envelope always wins. These mirrored rules exist only for instant
 * feedback before bytes leave the browser, so they must keep the same
 * messages and limits. Any drift produces a server-side rejection that
 * the form displays verbatim.
 */

import { sourceKindForExtension, UPLOAD_LIMITS } from "@kylosonic/opencontext-schemas";

export const ALLOWED_EXTENSIONS = UPLOAD_LIMITS.allowedExtensions;
export const MAX_BYTES = UPLOAD_LIMITS.maxBytes;
export const MAX_IMAGE_BYTES = UPLOAD_LIMITS.maxImageBytes;
export const MAX_PDF_BYTES = UPLOAD_LIMITS.maxPdfBytes;
export const MAX_AUDIO_BYTES = UPLOAD_LIMITS.maxAudioBytes;
export const MAX_IMAGE_COUNT = UPLOAD_LIMITS.maxImageCount;
/** upload.md B1 wording for the size limit chip. */
export const MAX_SIZE_LABEL = "500 MB";
export const MAX_IMAGE_SIZE_LABEL = "25 MB";
export const MAX_PDF_SIZE_LABEL = "50 MB";
export const MAX_AUDIO_SIZE_LABEL = "100 MB";
/** upload.md B2: stated pre-upload; enforced by the EXTRACTING probe. */
export const MAX_DURATION_LABEL = "30 minutes";

/** Mirrors src/server/validation/upload.ts wording exactly. */
export const FORMAT_MESSAGE =
  "This format is not supported — use MP4, MOV, WebM, MKV, MP3, M4A, WAV, OGG, AAC, FLAC, PNG, JPG, JPEG, WebP, or PDF";
/** Mirrors src/server/validation/upload.ts wording exactly. */
export const SIZE_MESSAGE = "File is too large — the limit is 500 MB";
export const IMAGE_SIZE_MESSAGE = "Image is too large — the limit is 25 MB";
export const PDF_SIZE_MESSAGE = "PDF is too large — the limit is 50 MB";
export const AUDIO_SIZE_MESSAGE = "Audio is too large — the limit is 100 MB";

export type ClientFileCheck =
  | { ok: true; extension: string; kind: "video" | "image" | "pdf" | "audio" }
  | { ok: false; message: string };

/** Mirror of validateUpload(filename, size) for instant client feedback. */
export function checkFileBeforeUpload(
  filename: string,
  sizeBytes: number,
): ClientFileCheck {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return { ok: false, message: "File size is invalid" };
  }
  if (sizeBytes === 0) {
    return { ok: false, message: "The file is empty" };
  }
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return { ok: false, message: FORMAT_MESSAGE };
  }
  const extension = filename.slice(dot).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, message: FORMAT_MESSAGE };
  }
  const normalizedExtension = extension.slice(1);
  const kind = sourceKindForExtension(normalizedExtension);
  const limit =
    kind === "image"
      ? MAX_IMAGE_BYTES
      : kind === "pdf"
        ? MAX_PDF_BYTES
        : kind === "audio"
          ? MAX_AUDIO_BYTES
          : MAX_BYTES;
  if (sizeBytes > limit) {
    return {
      ok: false,
      message:
        kind === "image"
          ? IMAGE_SIZE_MESSAGE
          : kind === "pdf"
            ? PDF_SIZE_MESSAGE
            : kind === "audio"
              ? AUDIO_SIZE_MESSAGE
            : SIZE_MESSAGE,
    };
  }
  return { ok: true, extension: normalizedExtension, kind };
}

/** Human file size, e.g. "24.3 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
