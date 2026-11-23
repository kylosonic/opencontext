import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS } from "@kylosonic/opencontext-schemas";
import {
  sanitizeDisplayName,
  validateStoredMedia,
  validateUpload,
} from "@/server/validation/upload";

const MAX = UPLOAD_LIMITS.maxBytes;

describe("validateUpload (upload.md B1 — authoritative server gate)", () => {
  it("accepts every allowed extension, case-insensitively", () => {
    for (const extension of [".mp4", ".mov", ".webm", ".mkv", ".MP4", ".Mkv"]) {
      const result = validateUpload(`video${extension}`, 1000);
      expect(result.ok, extension).toBe(true);
      if (result.ok) {
        expect(result.extension).toBe(extension.slice(1).toLowerCase());
        expect(result.mime).toMatch(/^video\//);
      }
    }
  });

  it("accepts a matching declared media type", () => {
    expect(validateUpload("video.mp4", 1000, "video/mp4").ok).toBe(true);
    expect(validateUpload("video.mkv", 1000, "video/x-matroska").ok).toBe(true);
  });

  it("normalizes browser codec parameters and generic video media types", () => {
    expect(validateUpload("clip.webm", 1000, "video/webm;codecs=vp9").ok).toBe(true);
    expect(validateUpload("clip.mkv", 1000, "application/octet-stream").ok).toBe(true);
    expect(validateUpload("clip.mov", 1000, "application/octet-stream").ok).toBe(true);
  });

  it("accepts supported images and returns their source kind", () => {
    const png = validateUpload("mockup.png", 1000, "image/png");
    const jpeg = validateUpload("reference.jpeg", 1000, "image/jpeg");
    const webp = validateUpload("diagram.webp", 1000);
    expect(png.ok && png.kind).toBe("image");
    expect(jpeg.ok && jpeg.kind).toBe("image");
    expect(webp.ok && webp.kind).toBe("image");
  });

  it("accepts PDFs up to 50 MB", () => {
    const result = validateUpload("spec.pdf", 1000, "application/pdf");
    expect(result.ok && result.kind).toBe("pdf");
    expect(validateUpload("huge.pdf", UPLOAD_LIMITS.maxPdfBytes + 1).ok).toBe(false);
  });

  it("rejects unsupported or mismatched media types", () => {
    expect(validateUpload("video.mp4", 1000, "text/plain").ok).toBe(false);
    expect(validateUpload("video.mp4", 1000, "video/webm").ok).toBe(false);
    expect(validateUpload("video.mov", 1000, "video/mp4").ok).toBe(false);
    expect(validateUpload("mockup.png", 1000, "image/jpeg").ok).toBe(false);
  });

  it("rejects unsupported formats with FORMAT_UNSUPPORTED", () => {
    for (const name of ["video.txt", "video.avi", "video.gif", "video.exe"]) {
      const result = validateUpload(name, 1000);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("FORMAT_UNSUPPORTED");
      }
    }
  });

  it("rejects files without an extension (B1 edge case)", () => {
    const result = validateUpload("noextension", 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORMAT_UNSUPPORTED");
    }
  });

  it("rejects trailing-dot names as unsupported", () => {
    const result = validateUpload("video.", 1000);
    expect(result.ok).toBe(false);
  });

  it("rejects oversized files with FILE_TOO_LARGE", () => {
    const result = validateUpload("big.mp4", MAX + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FILE_TOO_LARGE");
    }
  });

  it("accepts exactly the limit", () => {
    expect(validateUpload("big.mp4", MAX).ok).toBe(true);
  });

  it("applies the smaller 25 MB limit to still images", () => {
    expect(validateUpload("photo.jpg", UPLOAD_LIMITS.maxImageBytes).ok).toBe(true);
    const oversized = validateUpload(
      "photo.jpg",
      UPLOAD_LIMITS.maxImageBytes + 1,
    );
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.message).toBe("Image is too large — the limit is 25 MB");
    }
  });

  it("rejects empty files with VALIDATION_ERROR", () => {
    const result = validateUpload("empty.mp4", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("validateStoredMedia", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  it("accepts real image bytes and a PDF signature", async () => {
    expect(await validateStoredMedia(png, "png")).toMatchObject({
      ok: true,
      width: 1,
      height: 1,
    });
    expect(
      await validateStoredMedia(Buffer.from("%PDF-1.7\n"), "pdf"),
    ).toEqual({ ok: true });
  });

  it("rejects extension/content mismatches and corrupt bytes", async () => {
    const mismatch = await validateStoredMedia(png, "jpg");
    expect(mismatch.ok).toBe(false);
    const corrupt = await validateStoredMedia(Buffer.from("not an image"), "png");
    expect(corrupt.ok).toBe(false);
    const fakePdf = await validateStoredMedia(Buffer.from("not a pdf"), "pdf");
    expect(fakePdf.ok).toBe(false);
  });

  it("accepts QuickTime containers whose first atom is not ftyp", async () => {
    const wide = Buffer.alloc(16);
    wide.writeUInt32BE(8, 0);
    wide.write("wide", 4, "ascii");
    wide.writeUInt32BE(8, 8);
    wide.write("mdat", 12, "ascii");

    expect(await validateStoredMedia(wide, "mov")).toEqual({ ok: true });
  });
});

describe("sanitizeDisplayName (upload.md B6)", () => {
  it("keeps ordinary filenames verbatim", () => {
    expect(sanitizeDisplayName("banking demo (final).mp4")).toBe(
      "banking demo (final).mp4",
    );
  });

  it("strips path separators and control characters", () => {
    expect(sanitizeDisplayName("..\\..\\secret\\video.mp4")).toBe("....secretvideo.mp4");
    expect(sanitizeDisplayName("a\u0000b\u001fc.mp4")).toBe("abc.mp4");
  });

  it("renders HTML-like text harmlessly (plain text only)", () => {
    // `/` is a path separator and is stripped per blueprint §3 — real
    // filenames cannot contain slashes on any OS, so the practical
    // guarantee is that the remainder stays verbatim and is rendered as
    // text only.
    expect(sanitizeDisplayName("<script>alert('x')</script>.mp4")).toBe(
      "<script>alert('x')<script>.mp4",
    );
    expect(sanitizeDisplayName('<img src="x" onerror="alert(1)">.mp4')).toBe(
      '<img src="x" onerror="alert(1)">.mp4',
    );
  });

  it("caps the length", () => {
    const long = "x".repeat(1000) + ".mp4";
    expect(sanitizeDisplayName(long)).toHaveLength(255);
  });

  it("falls back to a safe name when everything is stripped", () => {
    expect(sanitizeDisplayName("\\\\")).toBe("media");
  });
});
