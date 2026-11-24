import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { completeUpload, createUploadIntent, getUploadIntent } from "@/server/uploads";
import { storage } from "@/server/storage";
import { canAccessWorkspace } from "@/server/workspaces";
import { validateUpload } from "@/server/validation/upload";

const MAX_REDIRECTS = 3;
const TOTAL_DOWNLOAD_MS = 240_000;

export class RemoteImportError extends Error {
  constructor(
    readonly code:
      | "INVALID_URL"
      | "UNSAFE_URL"
      | "FORBIDDEN"
      | "FETCH_FAILED"
      | "TOO_LARGE"
      | "UNSUPPORTED"
      | "VALIDATION_ERROR",
    message: string,
  ) {
    super(message);
  }
}

type OpenedRemote = {
  response: IncomingMessage;
  finalUrl: URL;
};

/**
 * Expand an IPv6 literal to its eight 16-bit groups. Handles the `::`
 * compression and a trailing dotted-quad form. Returns null when the input
 * is not a syntactically valid IPv6 address.
 */
function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase();
  // Strip a zone id such as `%eth0`; it is not part of the address.
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  let tail: number[] = [];
  let v4Part = false;
  const lastColon = value.lastIndexOf(":");
  const possibleV4 = value.slice(lastColon + 1);
  if (isIP(possibleV4) === 4) {
    const octets = possibleV4.split(".").map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    // Drop the `:a.b.c.d` suffix; the dotted quad supplies the final groups.
    value = value.slice(0, lastColon);
    v4Part = true;
  }

  const compressed = value.includes("::");
  const [headRaw = "", restRaw = ""] = value.split("::");
  const parts = (segment: string) => (segment ? segment.split(":").filter(Boolean) : []);
  const head = parts(headRaw).map((group) => parseInt(group, 16));
  const mid = parts(restRaw).map((group) => parseInt(group, 16));
  const typed = [...head, ...mid];
  if (typed.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }

  let groups: number[];
  if (compressed) {
    const zeros = 8 - typed.length - tail.length;
    if (zeros < 1) return null;
    groups = [...head, ...new Array<number>(zeros).fill(0), ...mid, ...tail];
  } else if (v4Part && typed.length === 0) {
    // `::a.b.c.d` collapses to the bare compression marker; the quad fills
    // the low 32 bits with the remaining groups zero.
    groups = [...new Array<number>(6).fill(0), ...tail];
  } else {
    groups = [...typed, ...tail];
  }
  return groups.length === 8 ? groups : null;
}

/** True for loopback, link-local, private, CGNAT, multicast, and reserved ranges. */
export function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets as [number, number, number, number];
    return (
      a === 0 || // "this network"
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local (cloud metadata)
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 192 && b === 0 && c === 0) || // reserved / IETF
      (a === 192 && b === 0 && c === 2) || // TEST-NET-1
      (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      a >= 224 // multicast, reserved, broadcast
    );
  }

  const groups = ipv6Groups(address);
  if (!groups) return true; // unparseable literals are refused, never fetched
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number, number, number, number, number, number, number, number,
  ];

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) forms must be
  // judged by the embedded IPv4 address, or they bypass every IPv4 rule.
  const zeroPrefix =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0);
  if (zeroPrefix && (g6 !== 0 || g7 !== 0)) {
    const v4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
    return isPrivateIp(v4);
  }
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return true; // ::1

  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (g0 & 0xff00) === 0xff00 || // multicast ff00::/8
    (g0 === 0x2001 && g1 === 0x0db8) || // documentation range
    (g0 === 0x2001 && g1 === 0x0000) || // Teredo tunneling 2001::/32
    g0 === 0x2002 || // 6to4 tunneling 2002::/16
    (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) || // discard-only 100::/64
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) || // NAT64 64:ff9b::/96
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001) // NAT64 local-use 64:ff9b:1::/48
  );
}

export async function resolvePublicHost(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImportError("INVALID_URL", "Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) {
    throw new RemoteImportError("UNSAFE_URL", "URLs with credentials or custom ports are not allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new RemoteImportError("UNSAFE_URL", "Local network URLs are not allowed");
  }
  const literalFamily = isIP(hostname);
  if (literalFamily && isPrivateIp(hostname)) {
    throw new RemoteImportError("UNSAFE_URL", "Private network URLs are not allowed");
  }
  const addresses: Array<{ address: string; family: 4 | 6 }> = literalFamily
    ? [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }]
    : (await lookup(hostname, { all: true, verbatim: true }).catch(() => [])).map(
        (item) => ({ address: item.address, family: item.family === 6 ? 6 : 4 }),
      );
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) {
    throw new RemoteImportError("UNSAFE_URL", "The URL does not resolve to a public address");
  }
  // Prefer IPv4 when both families resolve. A host may publish AAAA records
  // while the worker/network has no working IPv6 route.
  return addresses.sort((left, right) => left.family - right.family)[0];
}

function openOnce(url: URL): Promise<OpenedRemote> {
  return resolvePublicHost(url).then(
    ({ address, family }) =>
      new Promise<OpenedRemote>((resolve, reject) => {
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: {
              Accept: "video/*,audio/*,image/*,application/pdf",
              "User-Agent": "OpenContext URL import/1.0",
            },
            lookup: (_hostname, options, callback) => {
              // Node's happy-eyeballs resolver asks for all addresses. Return
              // the already validated address in the shape requested by the
              // caller instead of letting a mixed callback trigger
              // ERR_INVALID_IP_ADDRESS.
              const resolver = callback as unknown as (
                error: NodeJS.ErrnoException | null,
                addressOrList: string | Array<{ address: string; family: number }>,
                resolverFamily?: number,
              ) => void;
              if ((options as { all?: boolean }).all) {
                resolver(null, [{ address, family }]);
              } else {
                resolver(null, address, family);
              }
            },
            timeout: 30_000,
          },
          (response) => resolve({ response, finalUrl: url }),
        );
        request.once("timeout", () => request.destroy(new Error("Remote request timed out")));
        request.once("error", (error: NodeJS.ErrnoException) =>
          reject(
            new RemoteImportError(
              "FETCH_FAILED",
              `Could not reach the remote media URL${error.code ? ` (${error.code})` : ""}`,
            ),
          ),
        );
        request.end();
      }),
  );
}

async function openPublicUrl(raw: string): Promise<OpenedRemote> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new RemoteImportError("INVALID_URL", "Enter a valid HTTP or HTTPS URL");
  }
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const opened = await openOnce(url);
    const status = opened.response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = opened.response.headers.location;
      opened.response.destroy();
      if (!location) throw new RemoteImportError("FETCH_FAILED", "Redirect had no destination");
      try {
        url = new URL(location, url);
      } catch {
        throw new RemoteImportError("INVALID_URL", "Redirect destination is invalid");
      }
      continue;
    }
    if (status < 200 || status >= 300) {
      opened.response.destroy();
      throw new RemoteImportError("FETCH_FAILED", `Remote server returned HTTP ${status}`);
    }
    return opened;
  }
  throw new RemoteImportError("FETCH_FAILED", "Too many redirects");
}

function decodeFilenameComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed percent escape is untrusted input, not a server error.
    return value;
  }
}

export function safeFilename(
  url: URL,
  contentType: string | null,
  disposition: string,
): string {
  const headerName = disposition
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("filename="))
    ?.slice(9)
    .replace(/^"|"$/g, "");
  const candidate =
    headerName || decodeFilenameComponent(url.pathname.split("/").pop() || "");
  const fallbackByMime: Record<string, string> = {
    "video/mp4": "remote.mp4",
    "video/quicktime": "remote.mov",
    "video/webm": "remote.webm",
    "video/x-matroska": "remote.mkv",
    "audio/mpeg": "remote.mp3",
    "audio/mp4": "remote.m4a",
    "audio/wav": "remote.wav",
    "audio/ogg": "remote.ogg",
    "audio/aac": "remote.aac",
    "audio/flac": "remote.flac",
    "image/png": "remote.png",
    "image/jpeg": "remote.jpg",
    "image/webp": "remote.webp",
    "application/pdf": "remote.pdf",
  };
  return candidate && candidate.includes(".")
    ? candidate.slice(0, 255)
    : fallbackByMime[(contentType ?? "").split(";", 1)[0].trim().toLowerCase()] || "remote-media";
}

/**
 * Wrap the remote response in a web stream that enforces the declared size.
 * The download is bounded by Content-Length, and any short or overlong body is
 * rejected rather than silently stored.
 */
function boundedStream(
  source: Readable,
  expectedBytes: number,
): ReadableStream<Uint8Array> {
  let received = 0;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        source.destroy(new Error("REMOTE_TIMEOUT"));
        controller.error(new Error("REMOTE_TIMEOUT"));
      }, TOTAL_DOWNLOAD_MS);

      source.on("data", (chunk: Buffer) => {
        if (settled) return;
        received += chunk.byteLength;
        if (received > expectedBytes) {
          settled = true;
          clearTimer();
          source.destroy();
          controller.error(new Error("REMOTE_TOO_LARGE"));
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) {
          source.pause();
        }
      });
      source.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimer();
        if (received !== expectedBytes) {
          controller.error(new Error("REMOTE_LENGTH_MISMATCH"));
          return;
        }
        controller.close();
      });
      source.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimer();
        controller.error(error);
      });
    },
    pull() {
      if (!settled) {
        source.resume();
      }
    },
    cancel(reason) {
      settled = true;
      clearTimer();
      source.destroy(reason instanceof Error ? reason : undefined);
    },
  });
}

export type UrlImportInput = {
  userId: string;
  url: string;
  detailLevel: DetailLevel;
  workspaceId?: string;
};

export async function importRemoteUrl(input: UrlImportInput): Promise<{ jobId: string }> {
  if (
    input.workspaceId &&
    !(await canAccessWorkspace(input.workspaceId, input.userId))
  ) {
    throw new RemoteImportError("FORBIDDEN", "You don't have access to that team");
  }
  const opened = await openPublicUrl(input.url);
  const { response, finalUrl } = opened;
  const rawLength = response.headers["content-length"];
  const sizeBytes = Number(Array.isArray(rawLength) ? rawLength[0] : rawLength);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    response.destroy();
    throw new RemoteImportError(
      "VALIDATION_ERROR",
      "The remote server must provide a positive Content-Length",
    );
  }
  const contentTypeHeader = response.headers["content-type"];
  const contentType = (
    Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader ?? ""
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const dispositionHeader = response.headers["content-disposition"];
  const filename = safeFilename(
    finalUrl,
    contentType,
    Array.isArray(dispositionHeader) ? dispositionHeader[0] ?? "" : dispositionHeader ?? "",
  );
  const validation = validateUpload(filename, sizeBytes, contentType);
  if (!validation.ok) {
    response.destroy();
    throw new RemoteImportError(
      validation.code === "FILE_TOO_LARGE" ? "TOO_LARGE" : "UNSUPPORTED",
      validation.message,
    );
  }

  const intent = await createUploadIntent({
    userId: input.userId,
    filename,
    sizeBytes,
    mime: validation.mime,
    detailLevel: input.detailLevel,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  if (intent.kind === "INVALID") {
    response.destroy();
    throw new RemoteImportError("VALIDATION_ERROR", intent.message);
  }
  const lookup = await getUploadIntent(intent.uploadId, input.userId);
  if (lookup.kind !== "OK") {
    response.destroy();
    throw new RemoteImportError("FETCH_FAILED", "Could not initialize the remote import");
  }
  try {
    await storage.put(
      lookup.intent.tempKey,
      boundedStream(response, sizeBytes),
      { sizeBytes, contentType: validation.mime },
    );
    const completed = await completeUpload(intent.uploadId, input.userId);
    if (completed.kind === "OK") return { jobId: completed.job.id };
    throw new RemoteImportError(
      completed.kind === "INVALID_CONTENT" ? "VALIDATION_ERROR" : "FETCH_FAILED",
      completed.kind === "INVALID_CONTENT"
        ? completed.message
        : "The remote file could not be completed as an upload",
    );
  } catch (error) {
    response.destroy();
    await storage.delete(lookup.intent.tempKey).catch(() => undefined);
    await prisma.uploadIntent.deleteMany({ where: { id: intent.uploadId } });
    if (error instanceof RemoteImportError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("REMOTE_TOO_LARGE")) {
      throw new RemoteImportError("TOO_LARGE", "Remote media exceeds the upload limit");
    }
    if (message.includes("REMOTE_TIMEOUT")) {
      throw new RemoteImportError("FETCH_FAILED", "Remote media download timed out");
    }
    if (message.includes("REMOTE_LENGTH_MISMATCH")) {
      throw new RemoteImportError("FETCH_FAILED", "Remote media ended before its declared size");
    }
    throw new RemoteImportError("FETCH_FAILED", "Could not download the remote media");
  }
}
