import type { Job, Prisma } from "@prisma/client";
import {
  AnalyzeDataSchema,
  ContextDataSchema,
  SourceMetaSchema,
  sourceKindForExtension,
  SKIP_REASON_NO_AUDIO,
  TranscriptSegmentsSchema,
  TimelinePayloadSchema,
  type StageName,
  type StageState,
  type WorkerProgressRequest,
  type WorkerStageResultRequest,
  type WorkerSourceInfo,
} from "@kylosonic/opencontext-schemas";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { computeProgress } from "@/server/jobs/progress";
import { activeLease, LeaseLostError, renewedLease } from "@/server/queue";

/**
 * Worker-side job operations (ADR-0005): the Python worker reports stage
 * progress and results over HTTP; this module applies them to the job
 * row and the stage-specific tables. All functions require the caller to
 * already hold the lease (checked by the route layer).
 */

/** Stage → visible JobStatus while that stage is RUNNING (jobs.md B1). */
const STAGE_TO_JOB_STATUS: Record<StageName, Job["status"]> = {
  EXTRACTING: "EXTRACTING",
  TRANSCRIBING: "TRANSCRIBING",
  ANALYZING: "ANALYZING",
  AGGREGATING: "AGGREGATING",
  GENERATING_CONTEXT: "GENERATING_CONTEXT",
};

/** POST /api/worker/jobs/[id]/progress — updates stage state, renews lease. */
export async function applyProgress(
  job: Job,
  input: WorkerProgressRequest,
): Promise<Job> {
  const workerId = requireWorker(job);
  const now = new Date().toISOString();
  return prisma.$transaction(async (tx) => {
    const current = await renewLease(tx, job.id, workerId);
    const stageStates = (current.stageStates as StageState[]).map((state) => {
      if (state.stage !== input.stage) {
        return state;
      }
      const updated: StageState = {
        ...state,
        status: input.stageStatus,
        progress: input.progress,
        message: input.message ?? state.message,
      };
      if (input.stageStatus === "RUNNING" && state.status !== "RUNNING") {
        updated.startedAt = now;
      }
      if (
        state.status !== input.stageStatus &&
        (input.stageStatus === "SUCCEEDED" || input.stageStatus === "FAILED")
      ) {
        updated.completedAt = now;
      }
      return updated;
    });

    return tx.job.update({
      where: { id: job.id },
      data: {
        stageStates,
        progress: computeProgress(stageStates),
        ...(input.stageStatus === "RUNNING"
          ? { status: STAGE_TO_JOB_STATUS[input.stage] }
          : {}),
      },
    });
  });
}

/** POST /api/worker/jobs/[id]/heartbeat — renew the lease without rewriting stage state. */
export async function applyHeartbeat(job: Job): Promise<Job> {
  const workerId = requireWorker(job);
  return prisma.$transaction((tx) => renewLease(tx, job.id, workerId));
}

/**
 * POST /api/worker/jobs/[id]/stage-result — idempotent upsert per stage
 * (blueprint §4 resume idempotency). Routes `data` into the dedicated
 * tables: EXTRACTING → probe metadata, TRANSCRIBING → segments,
 * ANALYZING → observations + OCR, AGGREGATING → timeline,
 * GENERATING_CONTEXT → ProcessingResult upsert. SKIPPED carries the
 * reason (e.g. NO_AUDIO, results B4 — not an error).
 */
export async function applyStageResult(
  job: Job,
  input: WorkerStageResultRequest,
): Promise<Job> {
  const workerId = requireWorker(job);
  const now = new Date().toISOString();
  return prisma.$transaction(async (tx) => {
    const current = await renewLease(tx, job.id, workerId);
    if (input.outcome === "SUCCEEDED" && input.data !== undefined) {
      await routeStageData(tx, job.id, input.stage, input.data);
    }

    const stageStates = (current.stageStates as StageState[]).map((state) => {
      if (state.stage !== input.stage) {
        return state;
      }
      return {
        ...state,
        status: input.outcome,
        attempt: input.attempt,
        completedAt: now,
        error:
          input.outcome === "SKIPPED"
            ? input.reason ?? SKIP_REASON_NO_AUDIO
            : input.error ?? null,
      };
    });

    const extra: Prisma.JobUpdateInput = {
      stageStates: stageStates as Prisma.InputJsonValue,
      progress: computeProgress(stageStates),
    };
    if (input.stage === "EXTRACTING" && input.outcome === "SUCCEEDED" && input.data) {
      const probe = SourceMetaSchema.safeParse(input.data);
      if (probe.success) {
        const meta = probe.data;
        if (meta.durationSec !== undefined) extra.durationSec = meta.durationSec;
        if (meta.width !== undefined) extra.width = meta.width;
        if (meta.height !== undefined) extra.height = meta.height;
        if (meta.audioPresent !== undefined) extra.audioPresent = meta.audioPresent;
        if (meta.frameCount !== undefined) extra.frameCount = meta.frameCount;
        if (meta.assetCount !== undefined) extra.assetCount = meta.assetCount;
        if (meta.pageCount !== undefined) extra.pageCount = meta.pageCount;
      }
    }
    if (input.stage === "AGGREGATING" && input.outcome === "SUCCEEDED" && input.data) {
      const parsed = (input.data as { timeline?: unknown }).timeline;
      if (parsed !== undefined) {
        const timeline = TimelinePayloadSchema.safeParse(parsed);
        if (!timeline.success) {
          throw new ZodStageDataError("AGGREGATING", "timeline payload is invalid");
        }
        extra.timeline = timeline.data as Prisma.InputJsonValue;
      }
    }

    return tx.job.update({ where: { id: job.id }, data: extra });
  });
}

class ZodStageDataError extends Error {
  constructor(
    public readonly stage: StageName,
    message: string,
  ) {
    super(`Stage data invalid (${stage}): ${message}`);
    this.name = "ZodStageDataError";
  }
}

async function routeStageData(
  tx: Prisma.TransactionClient,
  jobId: string,
  stage: StageName,
  data: unknown,
): Promise<void> {
  switch (stage) {
    case "TRANSCRIBING": {
      const payload = data as { segments?: unknown };
      if (!payload || !Array.isArray(payload.segments)) {
        throw new ZodStageDataError("TRANSCRIBING", "expected { segments: [...] }");
      }
      const parsedSegments = TranscriptSegmentsSchema.safeParse(payload.segments);
      if (!parsedSegments.success) {
        throw new ZodStageDataError("TRANSCRIBING", "segments payload is invalid");
      }
      const segments = parsedSegments.data;
      await tx.transcriptSegment.deleteMany({ where: { jobId } });
      await tx.transcriptSegment.createMany({
        data: segments.map((segment) => ({
          jobId,
          start: segment.start,
          end: segment.end,
          text: segment.text,
          provider: segment.provider,
        })),
      });
      return;
    }
    case "ANALYZING": {
      const parsed = AnalyzeDataSchema.safeParse(data);
      if (!parsed.success) {
        throw new ZodStageDataError("ANALYZING", "expected { observations, ocr }");
      }
      const { observations, ocr } = parsed.data;
      await tx.visualObservation.deleteMany({ where: { jobId } });
      await tx.ocrObservation.deleteMany({ where: { jobId } });
      await tx.visualObservation.createMany({
        data: observations.map((observation) => ({
          jobId,
          frameId: observation.frameId ?? null,
          timestampSec: observation.timestampSec,
          certainty: observation.certainty,
          sceneTitle: observation.sceneTitle,
          visualDescription: observation.visualDescription,
          uiElements: observation.uiElements as Prisma.InputJsonValue,
          visibleText: observation.visibleText as Prisma.InputJsonValue,
          interactions: observation.interactions as Prisma.InputJsonValue,
          layoutDescription: observation.layoutDescription,
          designObservations:
            observation.designObservations as Prisma.InputJsonValue,
          importantChanges: observation.importantChanges as Prisma.InputJsonValue,
          provider: observation.provider,
        })),
      });
      await tx.ocrObservation.createMany({
        data: ocr.map((entry) => ({
          jobId,
          frameId: entry.frameId ?? null,
          timestampSec: entry.timestampSec,
          text: entry.text,
          confidence: entry.confidence,
          provider: entry.provider,
        })),
      });
      return;
    }
    case "GENERATING_CONTEXT": {
      const parsed = ContextDataSchema.safeParse(data);
      if (!parsed.success) {
        throw new ZodStageDataError("GENERATING_CONTEXT", "expected { markdown, json }");
      }
      const formatVersion = parsed.data.json.formatVersion ?? 1;
      await tx.processingResult.upsert({
        where: { jobId },
        create: {
          jobId,
          markdown: parsed.data.markdown,
          json: parsed.data.json as Prisma.InputJsonValue,
          formatVersion,
        },
        update: {
          markdown: parsed.data.markdown,
          json: parsed.data.json as Prisma.InputJsonValue,
          formatVersion,
        },
      });
      return;
    }
    case "EXTRACTING":
    case "AGGREGATING":
      // Handled on the job row itself (probe metadata / timeline column).
      return;
    default:
      throw new ZodStageDataError(stage, "unexpected stage data");
  }
}

/** GET /api/worker/jobs/[id]/source — fetch instructions for the media. */
export async function getWorkerSourceInfo(job: Job): Promise<WorkerSourceInfo> {
  const key = job.sourceKey;
  if (!key) {
    throw new Error(`Job ${job.id} has no source object`);
  }
  const sizeBytes = job.sourceSize ?? 0;
  const filename = job.displayName;
  const kind = sourceKindForExtension(job.sourceExt ?? "");
  const media = await prisma.media.findMany({
    where: { jobId: job.id, kind: "SOURCE" },
    orderBy: { timestampSec: "asc" },
  });
  const ordered = media.length > 0 ? media : [];
  const assets = await Promise.all(
    ordered.map(async (item, index) => {
      const dot = item.key.lastIndexOf(".");
      const ext = (dot >= 0 ? item.key.slice(dot + 1) : "").toLowerCase();
      const uri =
        storage.provider === "s3"
          ? await storage.presign(item.key, 3600)
          : `/api/worker/media/${item.key}`;
      if (!uri) {
        throw new Error(`S3 presign failed for ${item.key}`);
      }
      return {
        uri,
        provider: storage.provider,
        sizeBytes: item.sizeBytes,
        filename:
          ordered.length === 1
            ? filename
            : kind === "pdf"
              ? `PDF source`
              : `Image ${index + 1}`,
        kind: sourceKindForExtension(ext),
        ext,
        mime: item.mime ?? "application/octet-stream",
        order: index,
      };
    }),
  );
  if (storage.provider === "s3") {
    const uri = await storage.presign(key, 3600);
    if (!uri) {
      throw new Error(`S3 presign failed for ${key}`);
    }
    return {
      uri,
      provider: "s3",
      sizeBytes,
      filename,
      kind,
      ...(assets.length > 0 ? { assets } : {}),
    };
  }
  return {
    uri: `/api/worker/media/${key}`,
    provider: "local",
    sizeBytes,
    filename,
    kind,
    ...(assets.length > 0 ? { assets } : {}),
  };
}

function requireWorker(job: Job): string {
  if (!job.claimedBy) {
    throw new LeaseLostError(job.id);
  }
  return job.claimedBy;
}

async function renewLease(
  tx: Prisma.TransactionClient,
  jobId: string,
  workerId: string,
): Promise<Job> {
  const now = new Date();
  const renewed = await tx.job.updateMany({
    where: { id: jobId, ...activeLease(workerId, now) },
    data: { leaseUntil: renewedLease(now) },
  });
  if (renewed.count === 0) {
    throw new LeaseLostError(jobId);
  }
  return tx.job.findUniqueOrThrow({ where: { id: jobId } });
}
