import type { Job } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { activeLease, LeaseLostError } from "./lease";

export type CompleteResult =
  | { kind: "NOT_FOUND" }
  | { kind: "NOT_CLAIMED" }
  | { kind: "STAGES_NOT_TERMINAL" }
  | { kind: "STAGES_FAILED" }
  | { kind: "OK"; job: Job };

/**
 * Mark a job COMPLETED (worker complete endpoint). Idempotent: an
 * already-COMPLETED job returns its current state. Requires the caller
 * to hold the lease (`claimedBy === workerId`) and every stage to be
 * terminal (blueprint §2: "all stages terminal → COMPLETED").
 */
export async function completeJob(jobId: string, workerId: string): Promise<CompleteResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { kind: "NOT_FOUND" };
  }
  if (job.status === "COMPLETED") {
    return { kind: "OK", job };
  }
  const now = new Date();
  if (
    job.claimedBy !== workerId ||
    !job.leaseUntil ||
    job.leaseUntil.getTime() <= now.getTime()
  ) {
    return { kind: "NOT_CLAIMED" };
  }
  const stages = (job.stageStates as { status?: string }[]) ?? [];
  const allSuccessful =
    stages.length > 0 &&
    stages.every((state) => ["SUCCEEDED", "SKIPPED"].includes(state.status ?? ""));
  if (stages.some((state) => state.status === "FAILED")) {
    return { kind: "STAGES_FAILED" };
  }
  if (!allSuccessful) {
    return { kind: "STAGES_NOT_TERMINAL" };
  }
  const updated = await prisma.job.updateMany({
    where: { id: jobId, ...activeLease(workerId, now) },
    data: {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      failureKind: "NONE",
      claimedBy: null,
      leaseUntil: null,
      availableAt: null,
    },
  });
  if (updated.count === 0) {
    const current = await prisma.job.findUnique({ where: { id: jobId } });
    if (current?.status === "COMPLETED") {
      return { kind: "OK", job: current };
    }
    throw new LeaseLostError(jobId);
  }
  return { kind: "OK", job: await prisma.job.findUniqueOrThrow({ where: { id: jobId } }) };
}
