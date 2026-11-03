import { prisma } from "@/server/db/prisma";
import { timelineEntriesView, type JobResultData } from "./jobViews";

/**
 * Read-only loader for the results of a terminal (COMPLETED/PARTIAL) job.
 * Slice 5 renders results server-side in the job page and maps them onto
 * the results-shell prop contract; the API state routes never carry these
 * collections, so this page-level read closes the gap without touching
 * route behavior.
 *
 * PARTIAL jobs keep whatever succeeded: transcript rows, observations,
 * OCR rows, and the persisted timeline (jobs.md B4). ProcessingResult is
 * null when GENERATING_CONTEXT never ran.
 */
export async function loadJobResultsData(jobId: string): Promise<JobResultData> {
  const [segments, observations, ocrRows, job] = await Promise.all([
    prisma.transcriptSegment.findMany({
      where: { jobId },
      orderBy: { start: "asc" },
    }),
    prisma.visualObservation.findMany({
      where: { jobId },
      orderBy: { timestampSec: "asc" },
    }),
    prisma.ocrObservation.findMany({
      where: { jobId },
      orderBy: { timestampSec: "asc" },
    }),
    prisma.job.findUnique({
      where: { id: jobId },
      select: {
        timeline: true,
        result: {
          select: { markdown: true, json: true, formatVersion: true },
        },
      },
    }),
  ]);

  return {
    transcript: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
    })),
    observations: observations.map((row) => ({
      timestampSec: row.timestampSec,
      certainty: row.certainty,
      sceneTitle: row.sceneTitle ?? undefined,
      visualDescription: row.visualDescription ?? undefined,
      uiElements: asStringArray(row.uiElements),
      visibleText: asStringArray(row.visibleText),
      interactions: asStringArray(row.interactions),
      layoutDescription: row.layoutDescription ?? undefined,
      designObservations: asStringRecord(row.designObservations),
      importantChanges: asStringArray(row.importantChanges),
    })),
    ocr: ocrRows.map((row) => ({
      timestampSec: row.timestampSec,
      text: row.text,
      ...(row.confidence !== null ? { confidence: row.confidence } : {}),
    })),
    timeline: timelineEntriesView(job?.timeline),
    markdown: job?.result?.markdown ?? null,
    json: job?.result?.json ?? null,
    formatVersion: job?.result?.formatVersion ?? null,
  };
}

/** Prisma Json arrays arrive as JsonValue; keep only the strings. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

/** Keep only string-valued design observations (the shell prints them). */
function asStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      record[key] = item;
    }
  }
  return Object.keys(record).length > 0 ? record : undefined;
}
