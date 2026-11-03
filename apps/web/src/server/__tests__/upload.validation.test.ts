import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS } from "@opencontext/schemas";
import { sanitizeDisplayName, validateUpload } from "@/server/validation/upload";

const MAX = UPLOAD_LIMITS.maxBytes;

describe("validateUpload (upload.md B1 — authoritative server gate)", () => {
  it("accepts every allowed extension, case-insensitively", () => {
    for (const extension of [".mp4", ".mov", ".webm", ".mkv", ".MP4", ".Mkv"]) {
      const result = validateUpload(`video${extension}`, 1000);
      expect(result.ok, extension).toBe(true);
      if (result.ok) {
        expect(result.extension).toBe(extension.slice(1).toLowerCase());
      }
    }
  });

  it("rejects unsupported formats with FORMAT_UNSUPPORTED", () => {
    for (const name of ["video.txt", "video.avi", "video.pdf", "video.exe"]) {
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

  it("rejects empty files with VALIDATION_ERROR", () => {
    const result = validateUpload("empty.mp4", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_ERROR");
    }
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
    expect(sanitizeDisplayName("\\\\")).toBe("video");
  });
});
