import type { Job } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

export type CompleteResult =
  | { kind: "NOT_CLAIMED" }
  | { kind: "STAGES_NOT_TERMINAL" }
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
    return { kind: "NOT_CLAIMED" };
  }
  if (job.status === "COMPLETED") {
    return { kind: "OK", job };
  }
  if (job.claimedBy !== workerId) {
    return { kind: "NOT_CLAIMED" };
  }
  const stages = (job.stageStates as { status?: string }[]) ?? [];
  const allTerminal =
    stages.length > 0 &&
    stages.every((state) =>
      ["SUCCEEDED", "SKIPPED", "FAILED"].includes(state.status ?? ""),
    );
  if (!allTerminal) {
    return { kind: "STAGES_NOT_TERMINAL" };
  }
  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      claimedBy: null,
      leaseUntil: null,
      availableAt: null,
    },
  });
  return { kind: "OK", job: updated };
}
