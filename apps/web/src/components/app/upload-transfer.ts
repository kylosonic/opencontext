/**
 * Client-side upload helpers, option definitions, and error envelope decoding
 * shared by `NewJobForm`.
 */

export type DetailLevelId = "LOW" | "MEDIUM" | "HIGH";

export interface DetailLevelOption {
  id: DetailLevelId;
  name: string;
  description: string;
  default?: boolean;
}

export interface WorkspaceOption {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export const DETAIL_LEVELS: DetailLevelOption[] = [
  {
    id: "LOW",
    name: "Low",
    description:
      "Core visual summary and major changes only — the smallest output.",
  },
  {
    id: "MEDIUM",
    name: "Medium",
    description:
      "Everything in Low plus visual descriptions, UI elements, visible text (OCR), and user interactions.",
    default: true,
  },
  {
    id: "HIGH",
    name: "High",
    description:
      "Everything in Medium plus fine-grained detail, design observations, and an exhaustive UI inventory.",
  },
];

export class UploadRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Decode a failed upload JSON response into a typed `UploadRequestError`. */
export async function uploadError(
  response: Response,
): Promise<UploadRequestError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    return new UploadRequestError(
      body.error?.code ?? "INTERNAL",
      body.error?.message ?? "Upload failed — please try again.",
    );
  } catch {
    return new UploadRequestError("INTERNAL", "Upload failed — please try again.");
  }
}

/** Transfer one file to the target presigned or local upload endpoint via XHR. */
export function putFileWithProgress(
  target: { url: string; headers: Record<string, string> },
  file: File,
  onProgress: (percent: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const absoluteUrl = new URL(target.url, window.location.origin);
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", absoluteUrl.href);
    xhr.withCredentials = absoluteUrl.origin === window.location.origin;
    for (const [name, value] of Object.entries(target.headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(
        new UploadRequestError("TRANSFER_FAILED", "The file transfer failed."),
      );
    };
    xhr.onerror = () =>
      reject(new UploadRequestError("NETWORK", "Network error"));
    xhr.onabort = () =>
      reject(new UploadRequestError("CANCELED", "Upload canceled"));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Threshold above which single-file uploads use resumable multipart chunks. */
export const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;

export interface ResumableStatusResponse {
  uploadId: string;
  sizeBytes: number;
  chunkSizeBytes: number;
  totalParts: number;
  uploadedParts: Array<{ partNumber: number; sizeBytes: number }>;
  uploadedBytes: number;
}

/** Upload one byte slice to `/api/uploads/[id]/chunks/[partNumber]` via XHR. */
export function putChunkWithProgress(
  uploadId: string,
  partNumber: number,
  chunk: Blob,
  onProgress: (loadedBytes: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const targetUrl = `/api/uploads/${encodeURIComponent(uploadId)}/chunks/${partNumber}`;
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", targetUrl);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(chunk.size);
        resolve();
        return;
      }
      reject(
        new UploadRequestError("TRANSFER_FAILED", "A file chunk failed to upload."),
      );
    };
    xhr.onerror = () =>
      reject(new UploadRequestError("NETWORK", "Network error"));
    xhr.onabort = () =>
      reject(new UploadRequestError("CANCELED", "Upload canceled"));
    xhr.send(chunk);
  });
  return { promise, abort: () => xhr.abort() };
}

/**
 * Execute or resume a multipart chunked upload, skipping parts already
 * confirmed by `/api/uploads/[id]/status`.
 */
export async function uploadResumableFile(
  file: File,
  options: {
    detailLevel: DetailLevelId;
    workspaceId?: string;
    existingUploadId?: string | null;
    isAborted: () => boolean;
    onSessionCreated: (uploadId: string, totalParts: number) => void;
    onProgress: (percent: number, currentPart: number, totalParts: number) => void;
    registerAbort: (abortFn: (() => void) | null) => void;
  },
): Promise<string> {
  let uploadId = options.existingUploadId ?? null;
  let chunkSizeBytes = 0;
  let totalParts = 0;
  const completedParts = new Set<number>();
  let completedBytes = 0;

  if (uploadId) {
    const statusRes = await fetch(
      `/api/uploads/${encodeURIComponent(uploadId)}/status`,
      { headers: { Accept: "application/json" } },
    );
    if (statusRes.ok) {
      const status = (await statusRes.json()) as ResumableStatusResponse;
      if (status.sizeBytes === file.size && status.totalParts > 0) {
        chunkSizeBytes = status.chunkSizeBytes;
        totalParts = status.totalParts;
        for (const part of status.uploadedParts) {
          completedParts.add(part.partNumber);
          completedBytes += part.sizeBytes;
        }
        options.onSessionCreated(uploadId, totalParts);
      } else {
        uploadId = null;
      }
    } else {
      uploadId = null;
    }
  }

  if (!uploadId) {
    const initResponse = await fetch("/api/uploads/multipart", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: file.name,
        sizeBytes: file.size,
        mime: file.type || undefined,
        detailLevel: options.detailLevel,
        workspaceId: options.workspaceId || undefined,
      }),
    });
    if (!initResponse.ok) throw await uploadError(initResponse);
    const created = (await initResponse.json()) as {
      uploadId: string;
      chunkSizeBytes: number;
      totalParts: number;
    };
    uploadId = created.uploadId;
    chunkSizeBytes = created.chunkSizeBytes;
    totalParts = created.totalParts;
    options.onSessionCreated(uploadId, totalParts);
  }

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (options.isAborted()) {
      throw new UploadRequestError("CANCELED", "Upload canceled");
    }
    if (completedParts.has(partNumber)) {
      options.onProgress(
        Math.round((completedBytes / Math.max(1, file.size)) * 95),
        partNumber,
        totalParts,
      );
      continue;
    }

    const start = (partNumber - 1) * chunkSizeBytes;
    const end = Math.min(file.size, start + chunkSizeBytes);
    const slice = file.slice(start, end);

    const chunkTransfer = putChunkWithProgress(uploadId, partNumber, slice, (loaded) => {
      const totalLoaded = completedBytes + Math.min(slice.size, loaded);
      options.onProgress(
        Math.round((totalLoaded / Math.max(1, file.size)) * 95),
        partNumber,
        totalParts,
      );
    });
    options.registerAbort(chunkTransfer.abort);
    await chunkTransfer.promise;
    options.registerAbort(null);
    completedParts.add(partNumber);
    completedBytes += slice.size;
  }

  return uploadId;
}

/** Best-effort cleanup for unclaimed upload intents after cancel or failure. */
export async function cancelPendingUploads(uploadIds: string[]): Promise<void> {
  if (uploadIds.length === 0) return;
  await Promise.all(
    uploadIds.map((uploadId) =>
      fetch(`/api/uploads/${encodeURIComponent(uploadId)}`, {
        method: "DELETE",
      }).catch(() => undefined),
    ),
  );
}
