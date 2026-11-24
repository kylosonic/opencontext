import {
  sourceKindForExtension,
  UPLOAD_LIMITS,
  type ErrorCode,
  type SourceKind,
} from "@kylosonic/opencontext-schemas";
import sharp from "sharp";
import {
  AUDIO_SIZE_MESSAGE,
  IMAGE_SIZE_MESSAGE,
  MIMES_BY_EXTENSION,
  PDF_SIZE_MESSAGE,
  SUPPORTED_FORMAT_MESSAGE,
  VIDEO_SIZE_MESSAGE,
  sizeLimitForKind,
  sizeMessageForKind,
} from "@/lib/media-formats";

/**
 * Server-side upload validation (upload.md B1 + blueprint §3). The client
 * pre-validates for instant feedback; this is the authoritative gate.
 * Named reasons: FILE_TOO_LARGE, FORMAT_UNSUPPORTED, VALIDATION_ERROR.
 */

export {
  AUDIO_SIZE_MESSAGE,
  IMAGE_SIZE_MESSAGE,
  PDF_SIZE_MESSAGE,
  SUPPORTED_FORMAT_MESSAGE,
  VIDEO_SIZE_MESSAGE,
};

export type UploadValidation =
  | { ok: true; extension: string; mime: string; kind: SourceKind }
  | { ok: false; code: ErrorCode; message: string };

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
  if (sizeBytes > sizeLimitForKind(kind)) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: sizeMessageForKind(kind),
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
    const noun =
      kind === "image"
        ? "image"
        : kind === "pdf"
          ? "PDF"
          : kind === "audio"
            ? "audio"
            : "video";
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
    if (["mp3", "m4a", "wav", "ogg", "aac", "flac"].includes(ext)) {
      return validateAudioSignature(bytes, ext);
    }
    if (["mp4", "mov", "webm", "mkv"].includes(ext)) {
      const head = Buffer.from(bytes.subarray(0, 16));
      const isIsoBase = isIsoBmffHead(Buffer.from(bytes));
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
    if ((metadata.pages ?? 1) > 1) {
      return {
        ok: false,
        message: "Animated images are not supported — upload a still image",
      };
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

function validateAudioSignature(
  bytes: Uint8Array,
  extension: string,
): StoredMediaValidation {
  const buffer = Buffer.from(bytes.subarray(0, 16));
  const ascii = buffer.toString("ascii");
  const valid =
    (extension === "mp3" &&
      (ascii.startsWith("ID3") || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))) ||
    (extension === "m4a" && buffer.subarray(4, 8).toString("ascii") === "ftyp") ||
    (extension === "wav" &&
      ascii.startsWith("RIFF") &&
      buffer.subarray(8, 12).toString("ascii") === "WAVE") ||
    (extension === "ogg" && ascii.startsWith("OggS")) ||
    (extension === "flac" && ascii.startsWith("fLaC")) ||
    (extension === "aac" && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0);
  return valid
    ? { ok: true }
    : { ok: false, message: "The uploaded audio content does not match its file format" };
}

function isIsoBmffHead(bytes: Buffer): boolean {
  // ISO base media and QuickTime files may legally begin with `wide`,
  // `mdat`, `moov`, or `free` instead of putting `ftyp` first. Validate the
  // advertised box size/type rather than requiring one fixed atom ordering.
  const allowed = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip"]);
  for (let offset = 0; offset + 8 <= bytes.length; offset += 8) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (allowed.has(type) && (size === 0 || size === 1 || size >= 8)) {
      return true;
    }
    break;
  }
  return false;
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
