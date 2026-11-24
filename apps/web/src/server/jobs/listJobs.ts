import { prisma } from "@/server/db/prisma";
import { jobToSummary } from "./serialize";

/** Max jobs returned by the list endpoint (blueprint §2: "latest 50"). */
export const LIST_LIMIT = 50;

/** Jobs owned by the caller or shared through one of their teams. */
export async function listJobs(userId: string) {
  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { userId },
        { workspace: { members: { some: { userId } } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  return jobs.map(jobToSummary);
}
