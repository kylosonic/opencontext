import type { DetailLevel, JobDetail, JobSummary } from "@kylosonic/opencontext-schemas";
import type { BillingOverview } from "@kylosonic/opencontext-schemas";
import type { UsageDashboardSummary } from "@/server/billing/usage";

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

export interface JobsListFilters {
  q?: string;
  status?: string;
  workspaceId?: string;
  sourceKind?: string;
}

/** GET /api/jobs — accessible job summaries, newest first, with optional filters. */
export async function fetchJobsList(
  filters: JobsListFilters = {},
): Promise<JobSummary[]> {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.workspaceId) params.set("workspaceId", filters.workspaceId);
  if (filters.sourceKind) params.set("sourceKind", filters.sourceKind);
  const qs = params.toString();
  const response = await fetch(qs ? `/api/jobs?${qs}` : "/api/jobs", {
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

/** PATCH /api/jobs/[id] — rename a job's display name. */
export async function patchJobRename(
  id: string,
  displayName: string,
): Promise<JobDetail> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ displayName }),
  });
  await ensureOk(response);
  return (await response.json()) as JobDetail;
}

/** POST /api/jobs/[id]/rerun — queue a new run at another detail level. */
export async function postJobRerun(
  id: string,
  detailLevel: DetailLevel,
): Promise<JobSummary> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/rerun`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ detailLevel }),
  });
  await ensureOk(response);
  return (await response.json()) as JobSummary;
}

/** GET /api/usage — aggregate completed analysis usage and cost summary. */
export async function fetchUsageSummary(
  options: { workspaceId?: string; days?: number } = {},
): Promise<UsageDashboardSummary> {
  const params = new URLSearchParams();
  if (options.workspaceId) params.set("workspaceId", options.workspaceId);
  if (options.days) params.set("days", String(options.days));
  const qs = params.toString();
  const response = await fetch(qs ? `/api/usage?${qs}` : "/api/usage", {
    headers: { Accept: "application/json" },
  });
  await ensureOk(response);
  return (await response.json()) as UsageDashboardSummary;
}

/** GET /api/billing/status — subscription state for a personal or team scope. */
export async function fetchBillingOverview(
  workspaceId?: string,
): Promise<BillingOverview> {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspaceId", workspaceId);
  const qs = params.toString();
  const response = await fetch(qs ? `/api/billing/status?${qs}` : "/api/billing/status", {
    headers: { Accept: "application/json" },
  });
  await ensureOk(response);
  return (await response.json()) as BillingOverview;
}

async function postBillingRedirect(
  path: "/api/billing/checkout" | "/api/billing/portal",
  workspaceId: string,
): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId: workspaceId || null }),
  });
  await ensureOk(response);
  const payload = (await response.json()) as { url?: unknown };
  if (typeof payload.url !== "string" || !URL.canParse(payload.url)) {
    throw new Error("Billing redirect URL is invalid");
  }
  return payload.url;
}

export function startBillingCheckout(workspaceId: string): Promise<string> {
  return postBillingRedirect("/api/billing/checkout", workspaceId);
}

export function openBillingPortal(workspaceId: string): Promise<string> {
  return postBillingRedirect("/api/billing/portal", workspaceId);
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
