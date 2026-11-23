import { Prisma } from "@prisma/client";
import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, readJsonBody, withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { getJob } from "@/server/jobs";
import {
  applyRateLimitHeaders,
  consumeRateLimit,
  RATE_LIMITS,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

const ReviewUpdateSchema = z
  .object({
    status: z.enum(["CONFIRMED", "FLAGGED", "UNREVIEWED"]),
    note: z.string().trim().max(1000).optional(),
    correctedText: z.string().trim().max(5000).optional(),
  })
  .strict()
  .refine(
    (review) => review.status === "FLAGGED" || !review.correctedText,
    { message: "Suggested corrections require a flagged review" },
  )
  .refine(
    (review) => review.status !== "UNREVIEWED" || (!review.note && !review.correctedText),
    { message: "Clearing a review cannot include annotations" },
  );

type RouteContext = {
  params: Promise<{ id: string; evidenceId: string }>;
};

/**
 * PATCH /api/jobs/[id]/evidence/[evidenceId] — save an owner's review while
 * retaining the model-produced claim as the evidence record's original text.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return withErrorHandling(async () => {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("UNAUTHORIZED", "Sign in required");
    }

    const { id, evidenceId: rawEvidenceId } = await context.params;
    const evidenceId = Number(rawEvidenceId);
    if (!Number.isSafeInteger(evidenceId) || evidenceId < 1) {
      return errorResponse("VALIDATION_ERROR", "Evidence id must be a positive integer");
    }
    const limit = await consumeRateLimit(
      `evidence-review:${session.user.id}`,
      RATE_LIMITS.evidenceReview.limit,
      RATE_LIMITS.evidenceReview.windowMs,
    );
    if (!limit.allowed) {
      return applyRateLimitHeaders(
        errorResponse(
          limit.unavailable ? "INTERNAL" : "RATE_LIMITED",
          limit.unavailable
            ? "Evidence review is temporarily unavailable — try again shortly"
            : `Evidence review limit reached — try again in ${limit.retryAfterSec} seconds`,
        ),
        limit,
      );
    }

    const jobResult = await getJob(id, session.user.id);
    if (jobResult.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (jobResult.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }

    const body = await readJsonBody(request, 10_000);
    if (!body.ok) {
      if (body.reason === "TOO_LARGE") {
        return errorResponse("VALIDATION_ERROR", "Review request is too large");
      }
      return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = ReviewUpdateSchema.safeParse(body.value);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Review data is invalid");
    }

    const updated = await updateEvidenceReview(id, evidenceId, parsed.data);
    if (updated === "NO_RESULT") {
      return errorResponse("NOT_FOUND", "This job has no generated context to review");
    }
    if (updated === "NO_LEDGER") {
      return errorResponse("NOT_FOUND", "This result has no evidence ledger");
    }
    if (updated === "NO_EVIDENCE") {
      return errorResponse("NOT_FOUND", "Evidence record not found");
    }

    return applyRateLimitHeaders(NextResponse.json(updated), limit);
  });
}

const REVIEW_APPENDIX_MARKER = "<!-- OpenContext human review -->";

interface ReviewUpdate {
  status: "CONFIRMED" | "FLAGGED" | "UNREVIEWED";
  note?: string;
  correctedText?: string;
}

async function updateEvidenceReview(
  jobId: string,
  evidenceId: number,
  review: ReviewUpdate,
): Promise<
  | { markdown: string; json: Prisma.JsonValue }
  | "NO_RESULT"
  | "NO_LEDGER"
  | "NO_EVIDENCE"
> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const result = await tx.processingResult.findUnique({ where: { jobId } });
          if (!result) return "NO_RESULT" as const;

          const json = asRecord(result.json);
          const records = json && Array.isArray(json.evidence) ? json.evidence : null;
          if (!json || !records) return "NO_LEDGER" as const;

          let evidenceFound = false;
          const evidence = records.map((record) => {
            const current = asRecord(record);
            if (!current || current.id !== evidenceId) return record;
            evidenceFound = true;
            const updated: Record<string, unknown> = { ...current };
            if (review.status === "UNREVIEWED") {
              delete updated.review;
            } else {
              updated.review = {
                status: review.status,
                ...(review.note ? { note: review.note } : {}),
                ...(review.correctedText
                  ? { correctedText: review.correctedText }
                  : {}),
                reviewedAt: new Date().toISOString(),
              };
            }
            return updated;
          });
          if (!evidenceFound) return "NO_EVIDENCE" as const;

          return tx.processingResult.update({
            where: { jobId },
            data: {
              json: { ...json, evidence } as Prisma.InputJsonValue,
              markdown: withReviewAppendix(result.markdown, evidence),
            },
            select: { markdown: true, json: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Evidence review update exhausted retries");
}

function withReviewAppendix(markdown: string, evidence: unknown[]): string {
  const generatedAt = markdown.lastIndexOf(REVIEW_APPENDIX_MARKER);
  const base = (generatedAt >= 0 ? markdown.slice(0, generatedAt) : markdown).trimEnd();
  const reviewed = evidence
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== null)
    .filter((record) => asRecord(record.review) !== null);
  if (reviewed.length === 0) {
    return base;
  }

  const rows = reviewed.map((record) => {
    const review = asRecord(record.review)!;
    const id = Number(record.id);
    const timestamp = formatTimestamp(Number(record.timestampSec) || 0);
    const status = review.status === "CONFIRMED" ? "Confirmed" : "Flagged";
    const lines = [`- **E${String(id).padStart(4, "0")} · ${timestamp} — ${status}.**`];
    if (typeof review.note === "string") {
      lines.push(`  - Note: ${escapeMarkdown(review.note)}`);
    }
    if (typeof review.correctedText === "string") {
      lines.push(
        `  - Suggested correction (original claim retained): ${escapeMarkdown(review.correctedText)}`,
      );
    }
    return lines.join("\n");
  });

  return `${base}\n\n${REVIEW_APPENDIX_MARKER}\n## Human review\n\n${rows.join("\n")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ");
}
