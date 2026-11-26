const DEFAULT_TIMEOUT_MS = 3_000;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

type DispatchEnvironment = Record<string, string | undefined>;
type DispatchLogger = Pick<Console, "warn">;

export interface WorkerDispatchOptions {
  env?: DispatchEnvironment;
  fetchImpl?: typeof fetch;
  logger?: DispatchLogger;
}

export type WorkerDispatchResult =
  | { kind: "DISABLED" }
  | { kind: "INVALID_CONFIGURATION"; reason: string }
  | { kind: "SENT"; status: number }
  | { kind: "FAILED"; status?: number };

interface WorkerDispatchConfig {
  repository: string;
  token: string;
  timeoutMs: number;
}

function resolveTimeoutMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 250) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, 10_000);
}

export function resolveWorkerDispatchConfig(
  env: DispatchEnvironment = process.env,
):
  | { ok: true; config: WorkerDispatchConfig }
  | { ok: false; disabled: true }
  | { ok: false; disabled: false; reason: string } {
  const token = env.GITHUB_WORKER_DISPATCH_TOKEN?.trim() ?? "";
  const repository = env.GITHUB_WORKER_DISPATCH_REPOSITORY?.trim() ?? "";
  if (!token && !repository) return { ok: false, disabled: true };
  if (!token || !repository) {
    return {
      ok: false,
      disabled: false,
      reason:
        "GITHUB_WORKER_DISPATCH_TOKEN and GITHUB_WORKER_DISPATCH_REPOSITORY must be configured together",
    };
  }
  if (!REPOSITORY_RE.test(repository)) {
    return {
      ok: false,
      disabled: false,
      reason: "GITHUB_WORKER_DISPATCH_REPOSITORY must use owner/repository format",
    };
  }
  return {
    ok: true,
    config: {
      repository,
      token,
      timeoutMs: resolveTimeoutMs(env.GITHUB_WORKER_DISPATCH_TIMEOUT_MS),
    },
  };
}

/**
 * Best-effort wake-up for the GitHub Actions worker relay.
 *
 * This function deliberately never throws. A dispatch outage must not turn a
 * successfully committed upload into an error, and the five-minute schedule
 * remains the durable fallback. Burst coalescing is owned by the workflow's
 * serialized concurrency group rather than serverless process memory.
 */
export async function notifyWorkerJobQueued(
  jobId: string,
  options: WorkerDispatchOptions = {},
): Promise<WorkerDispatchResult> {
  const logger = options.logger ?? console;
  const resolved = resolveWorkerDispatchConfig(options.env ?? process.env);
  if (!resolved.ok) {
    if (!resolved.disabled) {
      logger.warn(`Worker dispatch is misconfigured: ${resolved.reason}`);
      return {
        kind: "INVALID_CONFIGURATION",
        reason: resolved.reason,
      };
    }
    return { kind: "DISABLED" };
  }

  const { repository, token, timeoutMs } = resolved.config;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "opencontext-worker-dispatch",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: "job-queued",
          client_payload: { jobId },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      logger.warn(
        `Worker dispatch failed for ${repository}: GitHub returned HTTP ${response.status}`,
      );
      return { kind: "FAILED", status: response.status };
    }
    return { kind: "SENT", status: response.status };
  } catch (error) {
    // Error messages can include request internals. Log only the error class.
    const errorName = error instanceof Error ? error.name : "UnknownError";
    logger.warn(`Worker dispatch failed for ${repository}: ${errorName}`);
    return { kind: "FAILED" };
  }
}
