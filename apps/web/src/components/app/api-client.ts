import type { JobDetail, JobSummary } from "@opencontext/schemas";

/**
 * Client-side API helpers for the signed-in job pages. Every route is
 * session-protected (middleware + route auth), so errors arrive as the
 * `{ error: { code, message } }` envelope or a bare status.
 */

/** Parsed error envelope (`packages/schemas/src/errors.ts`). */
export interface ApiErrorEnvelope {
  code: string;
  message: string;
  stage?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly stage?: string;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message || `Request failed (HTTP ${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.code || "INTERNAL";
    this.stage = envelope.stage;
  }
}

/** True when the failure is a missing/expired session (identity.md B5). */
export function isSignInError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

async function readEnvelope(response: Response): Promise<ApiErrorEnvelope> {
  try {
    const body = (await response.json()) as { error?: ApiErrorEnvelope };
    return (
      body.error ?? { code: "INTERNAL", message: "Request failed" }
    );
  } catch {
    return { code: "INTERNAL", message: "Request failed" };
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new ApiError(response.status, await readEnvelope(response));
  }
}

/** GET /api/jobs — the caller's own job summaries, newest first. */
export async function fetchJobsList(): Promise<JobSummary[]> {
  const response = await fetch("/api/jobs", {
    headers: { Accept: "application/json" },
  });
  await ensureOk(response);
  return (await response.json()) as JobSummary[];
}

/** GET /api/jobs/[id] — full job state (owner only). */
export async function fetchJobDetail(id: string): Promise<JobDetail> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });
  await ensureOk(response);
  return (await response.json()) as JobDetail;
}

/** POST /api/jobs/[id]/retry — returns the updated full job state. */
export async function postJobRetry(id: string): Promise<JobDetail> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  await ensureOk(response);
  return (await response.json()) as JobDetail;
}

/** DELETE /api/jobs/[id] — 204 when the job and its media are removed. */
export async function deleteJobRequest(id: string): Promise<void> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await ensureOk(response);
}

export interface EvidenceReviewUpdate {
  status: "CONFIRMED" | "FLAGGED" | "UNREVIEWED";
  note?: string;
  correctedText?: string;
}

export interface EvidenceReviewResponse {
  markdown: string;
  json: unknown;
}

/** PATCH /api/jobs/[id]/evidence/[evidenceId] — save human review metadata. */
export async function patchEvidenceReviewRequest(
  jobId: string,
  evidenceId: number,
  review: EvidenceReviewUpdate,
): Promise<EvidenceReviewResponse> {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/evidence/${evidenceId}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(review),
    },
  );
  await ensureOk(response);
  return (await response.json()) as EvidenceReviewResponse;
}
