import {
  sourceKindForExtension,
  UPLOAD_LIMITS,
  type SourceKind,
} from "@kylosonic/opencontext-schemas";

/**
 * Canonical extension, MIME, and limit tables shared by client pre-flight
 * checks, server upload validation, remote URL imports, and media routes.
 */
export const MIMES_BY_EXTENSION: Record<string, readonly string[]> = {
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  webm: ["video/webm"],
  mkv: ["video/x-matroska"],
  png: ["image/png"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  mp3: ["audio/mpeg"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  wav: ["audio/wav", "audio/x-wav"],
  ogg: ["audio/ogg"],
  aac: ["audio/aac"],
  flac: ["audio/flac"],
};

export const SUPPORTED_FORMAT_MESSAGE =
  "This format is not supported — use MP4, MOV, WebM, MKV, MP3, M4A, WAV, OGG, AAC, FLAC, PNG, JPG, JPEG, WebP, or PDF";
export const VIDEO_SIZE_MESSAGE = "File is too large — the limit is 500 MB";
export const IMAGE_SIZE_MESSAGE = "Image is too large — the limit is 25 MB";
export const PDF_SIZE_MESSAGE = "PDF is too large — the limit is 50 MB";
export const AUDIO_SIZE_MESSAGE = "Audio is too large — the limit is 100 MB";

const UNIQUE_PRIMARY_MIMES = Array.from(
  new Set(Object.values(MIMES_BY_EXTENSION).map((mimes) => mimes[0])),
);

/** Value for `<input type="file" accept={...}>` aligned with `UPLOAD_LIMITS`. */
export const UPLOAD_ACCEPT_ATTR = [
  ...UPLOAD_LIMITS.allowedExtensions,
  ...UNIQUE_PRIMARY_MIMES,
].join(",");

/** Return the primary HTTP Content-Type for a stored source extension. */
export function contentTypeForExtension(extension: string): string | undefined {
  return MIMES_BY_EXTENSION[extension.toLowerCase()]?.[0];
}

/** True when a source extension renders via the inline preview endpoint (not video). */
export function isPreviewableSourceExtension(extension: string): boolean {
  const normalized = extension.toLowerCase();
  if (!(normalized in MIMES_BY_EXTENSION)) return false;
  return sourceKindForExtension(normalized) !== "video";
}

/** Map a declared Content-Type header (parameters stripped) to a canonical extension. */
export function extensionForMime(contentType: string): string | undefined {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized) return undefined;
  for (const [extension, mimes] of Object.entries(MIMES_BY_EXTENSION)) {
    if (mimes.includes(normalized)) return extension;
  }
  return undefined;
}

/** Maximum byte limit enforced for the given media kind. */
export function sizeLimitForKind(kind: SourceKind): number {
  switch (kind) {
    case "image":
      return UPLOAD_LIMITS.maxImageBytes;
    case "pdf":
      return UPLOAD_LIMITS.maxPdfBytes;
    case "audio":
      return UPLOAD_LIMITS.maxAudioBytes;
    case "video":
      return UPLOAD_LIMITS.maxBytes;
  }
}

/** User-facing size-limit rejection message for the given media kind. */
export function sizeMessageForKind(kind: SourceKind): string {
  switch (kind) {
    case "image":
      return IMAGE_SIZE_MESSAGE;
    case "pdf":
      return PDF_SIZE_MESSAGE;
    case "audio":
      return AUDIO_SIZE_MESSAGE;
    case "video":
      return VIDEO_SIZE_MESSAGE;
  }
}
