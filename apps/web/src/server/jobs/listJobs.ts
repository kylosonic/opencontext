import { prisma } from "@/server/db/prisma";
import { jobToSummary } from "./serialize";

/** Max jobs returned by the list endpoint (blueprint §2: "latest 50"). */
export const LIST_LIMIT = 50;

/**
 * The caller's own jobs, newest first (jobs.md B8). Empty list → `[]`.
 */
export async function listJobs(userId: string) {
  const jobs = await prisma.job.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  return jobs.map(jobToSummary);
}
