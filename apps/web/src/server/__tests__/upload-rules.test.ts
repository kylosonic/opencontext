import { describe, expect, it } from "vitest";
import {
  checkFileBeforeUpload,
  formatFileSize,
  FORMAT_MESSAGE,
  SIZE_MESSAGE,
} from "@/components/app/upload-rules";
import { validateUpload } from "@/server/validation/upload";

/**
 * Client pre-flight checks (upload.md B1): messages mirror the server's
 * named rejections so the form and the API never disagree about why a
 * file was refused.
 */
describe("checkFileBeforeUpload (client pre-flight)", () => {
  it("accepts the four supported extensions", () => {
    for (const [name, extension] of [
      ["demo.mp4", "mp4"],
      ["demo.MOV", "mov"],
      ["clip.webm", "webm"],
      ["raw.mkv", "mkv"],
    ] as const) {
      expect(checkFileBeforeUpload(name, 1024)).toEqual({
        ok: true,
        extension,
      });
    }
  });

  it("rejects unsupported formats with the server message", () => {
    expect(checkFileBeforeUpload("notes.txt", 1024)).toEqual({
      ok: false,
      message: FORMAT_MESSAGE,
    });
    expect(checkFileBeforeUpload("noextension", 1024)).toEqual({
      ok: false,
      message: FORMAT_MESSAGE,
    });
    expect(checkFileBeforeUpload(".mp4", 1024)).toEqual({
      ok: false,
      message: FORMAT_MESSAGE,
    });
    expect(checkFileBeforeUpload("trailer.mp4.exe", 1024)).toEqual({
      ok: false,
      message: FORMAT_MESSAGE,
    });
  });

  it("rejects files over the 500 MB limit", () => {
    const result = checkFileBeforeUpload("huge.mp4", 500 * 1024 * 1024 + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(SIZE_MESSAGE);
    }
  });

  it("mirrors the server validation messages byte for byte", () => {
    const format = validateUpload("notes.txt", 1024);
    expect(format.ok).toBe(false);
    if (!format.ok) {
      expect(FORMAT_MESSAGE).toBe(format.message);
    }
    const size = validateUpload("huge.mp4", 500 * 1024 * 1024 + 1);
    expect(size.ok).toBe(false);
    if (!size.ok) {
      expect(SIZE_MESSAGE).toBe(size.message);
    }
    const empty = validateUpload("empty.mp4", 0);
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(checkFileBeforeUpload("empty.mp4", 0)).toEqual({
        ok: false,
        message: empty.message,
      });
    }
  });

  it("rejects empty and invalid sizes", () => {
    expect(checkFileBeforeUpload("empty.mp4", 0)).toEqual({
      ok: false,
      message: "The file is empty",
    });
    expect(checkFileBeforeUpload("bad.mp4", Number.NaN)).toEqual({
      ok: false,
      message: "File size is invalid",
    });
  });
});

describe("formatFileSize", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25.0 MB");
  });
});
