import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS } from "@kylosonic/opencontext-schemas";
import {
  AUDIO_SIZE_MESSAGE,
  contentTypeForExtension,
  extensionForMime,
  IMAGE_SIZE_MESSAGE,
  isPreviewableSourceExtension,
  PDF_SIZE_MESSAGE,
  sizeLimitForKind,
  sizeMessageForKind,
  UPLOAD_ACCEPT_ATTR,
  VIDEO_SIZE_MESSAGE,
} from "@/lib/media-formats";

describe("media-formats", () => {
  it("resolves primary Content-Type for every allowed extension including ogg and flac", () => {
    for (const dotted of UPLOAD_LIMITS.allowedExtensions) {
      const ext = dotted.slice(1);
      expect(contentTypeForExtension(ext), ext).toBeTruthy();
    }
    expect(contentTypeForExtension("OGG")).toBe("audio/ogg");
    expect(contentTypeForExtension("flac")).toBe("audio/flac");
    expect(contentTypeForExtension("exe")).toBeUndefined();
  });

  it("maps MIME headers (stripping parameters) back to canonical extensions", () => {
    expect(extensionForMime("video/mp4; codecs=avc1")).toBe("mp4");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("audio/x-m4a")).toBe("m4a");
    expect(extensionForMime("audio/x-wav")).toBe("wav");
    expect(extensionForMime("application/pdf")).toBe("pdf");
    expect(extensionForMime("application/octet-stream")).toBeUndefined();
  });

  it("identifies non-video inline previewable extensions accurately", () => {
    expect(isPreviewableSourceExtension("png")).toBe(true);
    expect(isPreviewableSourceExtension("pdf")).toBe(true);
    expect(isPreviewableSourceExtension("mp3")).toBe(true);
    expect(isPreviewableSourceExtension("mp4")).toBe(false);
    expect(isPreviewableSourceExtension("webm")).toBe(false);
    expect(isPreviewableSourceExtension("unknown")).toBe(false);
  });

  it("returns matching byte limits and rejection messages by source kind", () => {
    expect(sizeLimitForKind("video")).toBe(UPLOAD_LIMITS.maxBytes);
    expect(sizeLimitForKind("image")).toBe(UPLOAD_LIMITS.maxImageBytes);
    expect(sizeLimitForKind("pdf")).toBe(UPLOAD_LIMITS.maxPdfBytes);
    expect(sizeLimitForKind("audio")).toBe(UPLOAD_LIMITS.maxAudioBytes);

    expect(sizeMessageForKind("video")).toBe(VIDEO_SIZE_MESSAGE);
    expect(sizeMessageForKind("image")).toBe(IMAGE_SIZE_MESSAGE);
    expect(sizeMessageForKind("pdf")).toBe(PDF_SIZE_MESSAGE);
    expect(sizeMessageForKind("audio")).toBe(AUDIO_SIZE_MESSAGE);
  });

  it("includes every allowed extension and primary MIME in UPLOAD_ACCEPT_ATTR", () => {
    const tokens = new Set(UPLOAD_ACCEPT_ATTR.split(","));
    for (const dotted of UPLOAD_LIMITS.allowedExtensions) {
      expect(tokens.has(dotted), dotted).toBe(true);
      const mime = contentTypeForExtension(dotted.slice(1));
      if (mime) expect(tokens.has(mime), mime).toBe(true);
    }
  });
});
