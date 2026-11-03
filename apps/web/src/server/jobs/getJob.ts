import { prisma } from "@/server/db/prisma";
import { jobToDetail } from "./serialize";

/**
 * Fetch one job by id. Throws typed results for the route layer to map:
 * `{ kind: "NOT_FOUND" }`, `{ kind: "FORBIDDEN" }`, or returns the detail.
 */
export type GetJobResult =
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK"; job: ReturnType<typeof jobToDetail> };

export async function getJob(jobId: string, userId: string): Promise<GetJobResult> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { kind: "NOT_FOUND" };
  }
  if (job.userId !== userId) {
    return { kind: "FORBIDDEN" };
  }
  return { kind: "OK", job: jobToDetail(job) };
}

/** Load the raw job row for owner-scoped mutations (retry/delete). */
export async function getOwnedJobRow(
  jobId: string,
  userId: string,
): Promise<
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" }
  | { kind: "OK"; job: Awaited<ReturnType<typeof prisma.job.findUnique>> }
> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { kind: "NOT_FOUND" };
  }
  if (job.userId !== userId) {
    return { kind: "FORBIDDEN" };
  }
  return { kind: "OK", job };
}
