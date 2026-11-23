import {
  sourceKindForExtension,
  UPLOAD_LIMITS,
  type ErrorCode,
  type SourceKind,
} from "@kylosonic/opencontext-schemas";
import sharp from "sharp";

/**
 * Server-side upload validation (upload.md B1 + blueprint §3). The client
 * pre-validates for instant feedback; this is the authoritative gate.
 * Named reasons: FILE_TOO_LARGE, FORMAT_UNSUPPORTED, VALIDATION_ERROR.
 */

export type UploadValidation =
  | { ok: true; extension: string; mime: string; kind: SourceKind }
  | { ok: false; code: ErrorCode; message: string };

const MIMES_BY_EXTENSION: Record<string, readonly string[]> = {
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  webm: ["video/webm"],
  mkv: ["video/x-matroska"],
  png: ["image/png"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
};

export const SUPPORTED_FORMAT_MESSAGE =
  "This format is not supported — use MP4, MOV, WebM, MKV, PNG, JPG, JPEG, WebP, or PDF";
export const VIDEO_SIZE_MESSAGE = "File is too large — the limit is 500 MB";
export const IMAGE_SIZE_MESSAGE = "Image is too large — the limit is 25 MB";
export const PDF_SIZE_MESSAGE = "PDF is too large — the limit is 50 MB";

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
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: SUPPORTED_FORMAT_MESSAGE,
    };
  }
  const extension = filename.slice(dot).toLowerCase();
  if (!(UPLOAD_LIMITS.allowedExtensions as readonly string[]).includes(extension)) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: SUPPORTED_FORMAT_MESSAGE,
    };
  }
  const normalizedExtension = extension.slice(1);
  const kind = sourceKindForExtension(normalizedExtension);
  const byteLimit =
    kind === "image"
      ? UPLOAD_LIMITS.maxImageBytes
      : kind === "pdf"
        ? UPLOAD_LIMITS.maxPdfBytes
        : UPLOAD_LIMITS.maxBytes;
  if (sizeBytes > byteLimit) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message:
        kind === "image"
          ? IMAGE_SIZE_MESSAGE
          : kind === "pdf"
            ? PDF_SIZE_MESSAGE
            : VIDEO_SIZE_MESSAGE,
    };
  }

  const inferredMimes = MIMES_BY_EXTENSION[normalizedExtension];
  const declaredMime = mime?.split(";", 1)[0]?.trim().toLowerCase() || "";
  // Browsers commonly report WebM codec parameters and may omit a precise
  // type for MKV/MOV files. The stored-content signature still provides the
  // authoritative format check at completion.
  const normalizedMime =
    declaredMime === "" || declaredMime === "application/octet-stream"
      ? inferredMimes[0]
      : declaredMime;
  if (
    !normalizedMime ||
    !(UPLOAD_LIMITS.allowedMimeTypes as readonly string[]).includes(normalizedMime)
  ) {
    const noun = kind === "image" ? "image" : kind === "pdf" ? "PDF" : "video";
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: `This file does not have a supported ${noun} media type`,
    };
  }
  if (!inferredMimes.includes(normalizedMime)) {
    return {
      ok: false,
      code: "FORMAT_UNSUPPORTED",
      message: "The file extension and media type do not match",
    };
  }
  return { ok: true, extension: normalizedExtension, mime: normalizedMime, kind };
}

export type StoredMediaValidation =
  | { ok: true; width?: number; height?: number }
  | { ok: false; message: string };

const IMAGE_FORMAT_BY_EXTENSION = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
} as const;

/**
 * Inspect stored bytes before creating a job. Sharp performs the full image
 * decode header check with a hard pixel ceiling; PDFs are checked for their
 * signature here and page count is enforced by the worker renderer.
 */
export async function validateStoredMedia(
  bytes: Uint8Array,
  extension: string,
): Promise<StoredMediaValidation> {
  const ext = extension.toLowerCase();
  if (ext === "pdf") {
    const signature = Buffer.from(bytes.subarray(0, 5)).toString("ascii");
    return signature === "%PDF-"
      ? { ok: true }
      : { ok: false, message: "The uploaded PDF is not a valid PDF file" };
  }
  if (!(ext in IMAGE_FORMAT_BY_EXTENSION)) {
    if (["mp4", "mov", "webm", "mkv"].includes(ext)) {
      const head = Buffer.from(bytes.subarray(0, 16));
      const isIsoBase =
        head.length >= 12 &&
        head.subarray(4, 8).toString("ascii") === "ftyp";
      const isEbml =
        head.length >= 4 &&
        head[0] === 0x1a &&
        head[1] === 0x45 &&
        head[2] === 0xdf &&
        head[3] === 0xa3;
      if (!isIsoBase && !isEbml) {
        return {
          ok: false,
          message: "The uploaded video content does not match a supported format",
        };
      }
    }
    return { ok: true };
  }

  const expected = IMAGE_FORMAT_BY_EXTENSION[
    ext as keyof typeof IMAGE_FORMAT_BY_EXTENSION
  ];
  if (!hasImageSignature(bytes, expected)) {
    return {
      ok: false,
      message: "The uploaded image content does not match its file format",
    };
  }
  try {
    const metadata = await sharp(Buffer.from(bytes), {
      failOn: "error",
      limitInputPixels: UPLOAD_LIMITS.maxImagePixels,
    }).metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height) {
      return { ok: false, message: "The uploaded image cannot be decoded" };
    }
    if (
      metadata.width * metadata.height >
      UPLOAD_LIMITS.maxImagePixels
    ) {
      return {
        ok: false,
        message: "Image dimensions are too large — the limit is 40 megapixels",
      };
    }
    return { ok: true, width: metadata.width, height: metadata.height };
  } catch {
    return {
      ok: false,
      message: "The uploaded image is corrupt or exceeds the 40-megapixel limit",
    };
  }
}

function hasImageSignature(
  bytes: Uint8Array,
  format: "png" | "jpeg" | "webp",
): boolean {
  if (format === "png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (format === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  );
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
  return cleaned.trim() === "" ? "media" : cleaned;
}
