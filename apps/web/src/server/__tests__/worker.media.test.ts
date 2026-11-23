import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/worker/media/[...key]/route";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { createQueuedJob, createUser, resetDatabase, resetStorage, TEST_BYTES } from "./helpers";

const TOKEN = "worker-media-test-token-at-least-16";

function request(key: string, workerId?: string): Request {
  return new Request(`http://test.local/api/worker/media/${key}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(workerId ? { "x-worker-id": workerId } : {}),
    },
  });
}

async function route(request: Request, key: string): Promise<Response> {
  return GET(request, { params: Promise.resolve({ key: key.split("/") }) });
}

beforeEach(async () => {
  process.env.WORKER_API_TOKEN = TOKEN;
  await resetDatabase();
  await resetStorage();
});

describe("worker media access", () => {
  it("serves an owned source only to a worker holding a live claim", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    const key = `jobs/${job.id}/source.png`;
    await storage.put(key, new Blob([TEST_BYTES]).stream(), { sizeBytes: TEST_BYTES.length });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        claimedBy: "worker-a",
        leaseUntil: new Date(Date.now() + 60_000),
        status: "EXTRACTING",
      },
    });
    await prisma.media.create({
      data: { jobId: job.id, kind: "SOURCE", key, sizeBytes: TEST_BYTES.length, mime: "image/png" },
    });

    const response = await route(request(key, "worker-a"), key);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(TEST_BYTES);
  });

  it("denies missing worker ids, wrong workers, expired leases, and unknown keys", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    const key = `jobs/${job.id}/source.webp`;
    await storage.put(key, new Blob([TEST_BYTES]).stream(), { sizeBytes: TEST_BYTES.length });
    await prisma.job.update({
      where: { id: job.id },
      data: { sourceKey: key, claimedBy: "worker-a", leaseUntil: new Date(Date.now() - 1) },
    });

    expect((await route(request(key), key)).status).toBe(401);
    expect((await route(request(key, "worker-b"), key)).status).toBe(404);
    expect((await route(request(key, "worker-a"), key)).status).toBe(404);

    await prisma.job.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(Date.now() + 60_000) },
    });
    expect((await route(request("incoming/private.txt", "worker-a"), "incoming/private.txt")).status).toBe(
      404,
    );
  });
});
