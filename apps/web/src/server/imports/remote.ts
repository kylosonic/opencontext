import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import type { DetailLevel } from "@kylosonic/opencontext-schemas";
import { extensionForMime } from "@/lib/media-formats";
import { prisma } from "@/server/db/prisma";
import { completeUpload, createUploadIntent, getUploadIntent } from "@/server/uploads";
import { storage } from "@/server/storage";
import { canAccessWorkspace } from "@/server/workspaces";
import { validateUpload } from "@/server/validation/upload";
import { isPrivateIp, RemoteImportError, resolvePublicHost } from "./ssrf";

export { isPrivateIp, RemoteImportError, resolvePublicHost };

const MAX_REDIRECTS = 3;
const TOTAL_DOWNLOAD_MS = 240_000;

type OpenedRemote = {
  response: IncomingMessage;
  finalUrl: URL;
};

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
  if (candidate && candidate.includes(".")) {
    return candidate.slice(0, 255);
  }
  const fallbackExt = extensionForMime(contentType ?? "");
  return fallbackExt ? `remote.${fallbackExt}` : "remote-media";
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
