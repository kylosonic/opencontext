import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errorResponse, withErrorHandling } from "@/server/api-helpers";
import { prisma } from "@/server/db/prisma";
import { getJob } from "@/server/jobs";

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

    const jobResult = await getJob(id, session.user.id);
    if (jobResult.kind === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "Job not found");
    }
    if (jobResult.kind === "FORBIDDEN") {
      return errorResponse("FORBIDDEN", "You don't have access to this job");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 10_000) {
      return errorResponse("VALIDATION_ERROR", "Review request is too large");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("VALIDATION_ERROR", "Request body must be valid JSON");
    }
    const parsed = ReviewUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("VALIDATION_ERROR", "Review data is invalid");
    }

    const result = await prisma.processingResult.findUnique({ where: { jobId: id } });
    if (!result) {
      return errorResponse("NOT_FOUND", "This job has no generated context to review");
    }

    const json = asRecord(result.json);
    if (!json) {
      return errorResponse("NOT_FOUND", "This result has no evidence ledger");
    }
    const records = Array.isArray(json.evidence) ? json.evidence : null;
    if (!records) {
      return errorResponse("NOT_FOUND", "This result has no evidence ledger");
    }

    let evidenceFound = false;
    const evidence = records.map((record) => {
      const current = asRecord(record);
      if (!current || current.id !== evidenceId) {
        return record;
      }
      evidenceFound = true;
      const updated: Record<string, unknown> = { ...current };
      if (parsed.data.status === "UNREVIEWED") {
        delete updated.review;
      } else {
        updated.review = {
          status: parsed.data.status,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          ...(parsed.data.correctedText
            ? { correctedText: parsed.data.correctedText }
            : {}),
          reviewedAt: new Date().toISOString(),
        };
      }
      return updated;
    });

    if (!evidenceFound) {
      return errorResponse("NOT_FOUND", "Evidence record not found");
    }

    const updatedJson = { ...json, evidence };
    const markdown = withReviewAppendix(result.markdown, evidence);
    const updated = await prisma.processingResult.update({
      where: { jobId: id },
      data: {
        json: updatedJson as Prisma.InputJsonValue,
        markdown,
      },
      select: { markdown: true, json: true },
    });

    return NextResponse.json(updated);
  });
}

const REVIEW_APPENDIX_MARKER = "<!-- OpenContext human review -->";

function withReviewAppendix(markdown: string, evidence: unknown[]): string {
  const base = markdown.split(REVIEW_APPENDIX_MARKER, 1)[0].trimEnd();
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
    .replace(/[\r\n]+/g, " ");
}
