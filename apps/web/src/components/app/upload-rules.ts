/**
 * Client-side pre-flight checks for the upload form (upload.md B1).
 *
 * The SERVER validation (`src/server/validation/upload.ts`, driven by
 * `@opencontext/schemas` UPLOAD_LIMITS) is authoritative — the 4xx error
 * envelope always wins. These mirrored rules exist only for instant
 * feedback before bytes leave the browser, so they must keep the same
 * messages and limits. Any drift produces a server-side rejection that
 * the form displays verbatim.
 */

export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"] as const;
export const MAX_BYTES = 500 * 1024 * 1024;
/** upload.md B1 wording for the size limit chip. */
export const MAX_SIZE_LABEL = "500 MB";
/** upload.md B2: stated pre-upload; enforced by the EXTRACTING probe. */
export const MAX_DURATION_LABEL = "30 minutes";

/** Mirrors src/server/validation/upload.ts wording exactly. */
export const FORMAT_MESSAGE =
  "This format is not supported — use MP4, MOV, WebM, or MKV";
/** Mirrors src/server/validation/upload.ts wording exactly. */
export const SIZE_MESSAGE = "File is too large — the limit is 500 MB";

export type ClientFileCheck =
  | { ok: true; extension: string }
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
  if (sizeBytes > MAX_BYTES) {
    return { ok: false, message: SIZE_MESSAGE };
  }
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return { ok: false, message: FORMAT_MESSAGE };
  }
  const extension = filename.slice(dot).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, message: FORMAT_MESSAGE };
  }
  return { ok: true, extension: extension.slice(1) };
}

/** Human file size, e.g. "24.3 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
