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
      "Core visual summary and major changes only - the smallest output.",
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
      body.error?.message ?? "Upload failed - please try again.",
    );
  } catch {
    return new UploadRequestError("INTERNAL", "Upload failed - please try again.");
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
