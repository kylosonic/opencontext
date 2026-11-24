import type { JobDetail } from "@kylosonic/opencontext-schemas";
import {
  contentTypeForExtension,
  isPreviewableSourceExtension,
} from "@/lib/media-formats";
import { storage } from "@/server/storage";

export interface ResolvedSourceAsset {
  key: string;
  extension: string;
  contentType: string;
}

/**
 * Select and validate an indexed source asset (or the single primary source)
 * for inline browser preview or public share playback.
 */
export function resolveSourceAsset(
  source: JobDetail["source"] | null | undefined,
  assetParam: string | null,
  options: { allowVideo: boolean },
): ResolvedSourceAsset | null {
  if (!source?.key) return null;
  const requestedIndex = Number(assetParam ?? "0");
  const assets = source.assets ?? [];
  const hasValidIndex =
    Number.isInteger(requestedIndex) &&
    requestedIndex >= 0 &&
    requestedIndex < assets.length;
  if (requestedIndex !== 0 && !hasValidIndex) {
    return null;
  }

  const asset = hasValidIndex ? assets[requestedIndex] : assets[0];
  const extension = (asset?.ext ?? source.ext).toLowerCase();
  if (!extension) return null;
  if (!options.allowVideo && !isPreviewableSourceExtension(extension)) {
    return null;
  }
  const contentType = contentTypeForExtension(extension);
  const key = asset?.key ?? source.key;
  if (!key || !contentType) return null;

  return { key, extension, contentType };
}

/**
 * Stream a resolved job source asset with safe caching, MIME sniffing
 * disabled, and same-origin framing headers for inline PDF viewing.
 */
export async function buildSourceStreamResponse(
  asset: ResolvedSourceAsset,
  options: {
    includeContentLength?: boolean;
    pdfFilenameDisposition?: boolean;
  } = {},
): Promise<Response | null> {
  const head = options.includeContentLength
    ? await storage.head(asset.key)
    : null;
  const body = await storage.stream(asset.key);
  if (!body) return null;

  const isPdf = asset.contentType === "application/pdf";
  const headers: Record<string, string> = {
    "Content-Type": asset.contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (head && head.sizeBytes > 0) {
    headers["Content-Length"] = String(head.sizeBytes);
  }
  if (options.pdfFilenameDisposition) {
    if (isPdf) {
      headers["Content-Disposition"] = "inline; filename=source.pdf";
    }
  } else {
    headers["Content-Disposition"] = "inline";
  }
  if (isPdf) {
    // This overrides the app-wide CSP for the PDF document. A sandbox or
    // default-src 'none' policy blocks built-in PDF viewers (and PDF.js),
    // while frame-ancestors 'self' prevents third-party embedding.
    headers["Content-Security-Policy"] = "frame-ancestors 'self'";
  }

  return new Response(body, { headers });
}
