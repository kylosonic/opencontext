import { auth } from "@/auth";
import {
  errorResponse,
  rateLimitDeniedResponse,
  withErrorHandling,
} from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { getJob } from "@/server/jobs";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";
import type { JobStatus } from "@kylosonic/opencontext-schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

const TERMINAL = new Set<JobStatus>(["COMPLETED", "PARTIAL", "FAILED"]);
const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 240_000;
const MAX_CONCURRENT_STREAMS = 5;
const activeStreams = new Map<string, number>();

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * GET /api/jobs/[id]/events — authenticated server-sent state updates.
 * The stream records its own lightweight change cursor, emits full detail
 * only when the job changes, and closes on a terminal state. EventSource
 * reconnects automatically if a serverless platform ends a long stream.
 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }
    const limit = await consumeRateLimit(
      `job-events:${session.user.id}`,
      RATE_LIMITS.jobRead.limit,
      RATE_LIMITS.jobRead.windowMs,
    );
    if (!limit.allowed) {
      return rateLimitDeniedResponse(limit, "Live job connection");
    }

    const { id } = await context.params;
    const initial = await getJob(id, session.user.id);
    if (initial.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (initial.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }

    const encoder = new TextEncoder();
    const userId = session.user.id;
    const currentStreams = activeStreams.get(userId) ?? 0;
    if (currentStreams >= MAX_CONCURRENT_STREAMS) {
      return applyRateLimitHeaders(
        errorResponse("RATE_LIMITED", "Too many concurrent live updates — close another tab or wait"),
        limit,
      );
    }
    activeStreams.set(userId, currentStreams + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = activeStreams.get(userId) ?? 1;
      if (count <= 1) activeStreams.delete(userId);
      else activeStreams.set(userId, count - 1);
    };

    let lastCursor = `${initial.job.updatedAt}:${initial.job.status}`;
    const streamAbort = new AbortController();
    const onRequestAbort = () => streamAbort.abort();
    request.signal.addEventListener("abort", onRequestAbort, { once: true });
    if (request.signal.aborted) streamAbort.abort();

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          let lastWrite = Date.now();
          const streamStartedAt = Date.now();
          const close = () => {
            if (closed) return;
            closed = true;
            streamAbort.abort();
            request.signal.removeEventListener("abort", onRequestAbort);
            release();
            try {
              controller.close();
            } catch {
              // The client may have disconnected between checks.
            }
          };
          streamAbort.signal.addEventListener("abort", close, { once: true });

          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
              lastWrite = Date.now();
            } catch {
              close();
            }
          };

          try {
            send("job", initial.job);
            if (TERMINAL.has(initial.job.status)) {
              close();
              return;
            }

            while (
              !closed &&
              !streamAbort.signal.aborted &&
              Date.now() - streamStartedAt < MAX_STREAM_MS
            ) {
              await sleep(POLL_MS, streamAbort.signal);
              if (closed || streamAbort.signal.aborted) break;
              try {
                const current = await prisma.job.findUnique({
                  where: { id },
                  select: { updatedAt: true, status: true },
                });
                if (!current) {
                  send("deleted", { id });
                  close();
                  break;
                }
                const cursor = `${current.updatedAt.toISOString()}:${current.status}`;
                if (cursor !== lastCursor) {
                  const detail = await getJob(id, userId);
                  if (detail.kind !== "OK") {
                    send("access-revoked", { id });
                    close();
                    break;
                  }
                  lastCursor = cursor;
                  send("job", detail.job);
                  if (TERMINAL.has(detail.job.status)) close();
                } else if (Date.now() - lastWrite >= HEARTBEAT_MS) {
                  try {
                    controller.enqueue(encoder.encode(": keepalive\n\n"));
                    lastWrite = Date.now();
                  } catch {
                    close();
                  }
                }
              } catch (error) {
                send("error", {
                  message:
                    error instanceof Error ? "Live updates interrupted" : "Unknown stream error",
                });
                close();
              }
            }
          } finally {
            close();
          }
        },
        cancel() {
          streamAbort.abort();
          request.signal.removeEventListener("abort", onRequestAbort);
          release();
        },
      });
    } catch (error) {
      request.signal.removeEventListener("abort", onRequestAbort);
      release();
      throw error;
    }

    return applyRateLimitHeaders(new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }), limit);
  });
}
