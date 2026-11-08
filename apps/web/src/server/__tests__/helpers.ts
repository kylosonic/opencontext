import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/server/db/prisma";
import { initialStageStates } from "@/server/jobs";

/** Wipe every table (SQLite FK enforcement is off; order is belt-and-braces). */
export async function resetDatabase(): Promise<void> {
  await prisma.rateLimitBucket.deleteMany();
  await prisma.processingResult.deleteMany();
  await prisma.visualObservation.deleteMany();
  await prisma.ocrObservation.deleteMany();
  await prisma.transcriptSegment.deleteMany();
  await prisma.media.deleteMany();
  await prisma.job.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}

export async function createUser(): Promise<{ id: string; email: string }> {
  const email = `test-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: { email, name: "Test User", githubId: `gh-${randomUUID()}`, githubLogin: "test-user" },
  });
  return { id: user.id, email };
}

export async function createQueuedJob(userId: string, displayName = "sample.mp4") {
  return prisma.job.create({
    data: {
      userId,
      displayName,
      status: "QUEUED",
      stageStates: initialStageStates(),
    },
  });
}

/** Remove the shared local test storage directory. */
export async function resetStorage(): Promise<void> {
  await rm(path.resolve(process.cwd(), ".test-storage"), {
    recursive: true,
    force: true,
  });
}

export const TEST_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

/** A web ReadableStream carrying TEST_BYTES. */
export function testStream(): ReadableStream<Uint8Array> {
  return new Blob([TEST_BYTES]).stream();
}
