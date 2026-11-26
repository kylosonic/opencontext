import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createJob, initialStageStates, rerunJob, retryJob } from "@/server/jobs";
import { claimJob, requeueJob } from "@/server/queue";
import {
  notifyWorkerJobQueued,
  resolveWorkerDispatchConfig,
} from "@/server/queue/dispatchWorker";
import { storage } from "@/server/storage";
import {
  createQueuedJob,
  createUser,
  resetDatabase,
  resetStorage,
  TEST_BYTES,
  testStream,
} from "./helpers";

const TOKEN = "github_pat_test-only-token";
const REPOSITORY = "kylosonic/opencontext";

function enableDispatch(): void {
  vi.stubEnv("GITHUB_WORKER_DISPATCH_TOKEN", TOKEN);
  vi.stubEnv("GITHUB_WORKER_DISPATCH_REPOSITORY", REPOSITORY);
}

function successfulFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 204 }));
}

async function createUploadedJob(userId: string) {
  const tempKey = `incoming/${randomUUID()}`;
  await storage.put(tempKey, testStream(), { sizeBytes: TEST_BYTES.length });
  return createJob({
    userId,
    displayName: "dispatch.png",
    detailLevel: "MEDIUM",
    sourceExt: "png",
    sourceSize: TEST_BYTES.length,
    sourceMime: "image/png",
    tempKey,
  });
}

beforeEach(async () => {
  await resetDatabase();
  await resetStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub worker dispatch", () => {
  it("stays disabled unless both repository and token are configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      notifyWorkerJobQueued("job-id", { env: {}, fetchImpl }),
    ).resolves.toEqual({ kind: "DISABLED" });
    await expect(
      notifyWorkerJobQueued("job-id", {
        env: { GITHUB_TOKEN: TOKEN },
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "DISABLED" });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      notifyWorkerJobQueued("job-id", {
        env: { GITHUB_WORKER_DISPATCH_TOKEN: TOKEN },
        fetchImpl,
        logger: { warn: vi.fn() },
      }),
    ).resolves.toMatchObject({ kind: "INVALID_CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates the repository and bounds the request timeout", () => {
    expect(
      resolveWorkerDispatchConfig({
        GITHUB_WORKER_DISPATCH_TOKEN: TOKEN,
        GITHUB_WORKER_DISPATCH_REPOSITORY: "https://example.com/not-a-repo",
      }),
    ).toMatchObject({ ok: false, disabled: false });
    expect(
      resolveWorkerDispatchConfig({
        GITHUB_WORKER_DISPATCH_TOKEN: TOKEN,
        GITHUB_WORKER_DISPATCH_REPOSITORY: REPOSITORY,
        GITHUB_WORKER_DISPATCH_TIMEOUT_MS: "999999",
      }),
    ).toMatchObject({
      ok: true,
      config: { repository: REPOSITORY, timeoutMs: 10_000 },
    });
  });

  it("posts the expected repository_dispatch payload with a scoped token", async () => {
    const fetchImpl = successfulFetch();

    await expect(
      notifyWorkerJobQueued("job-123", {
        env: {
          GITHUB_WORKER_DISPATCH_TOKEN: TOKEN,
          GITHUB_WORKER_DISPATCH_REPOSITORY: REPOSITORY,
        },
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "SENT", status: 204 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `https://api.github.com/repos/${REPOSITORY}/dispatches`,
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "opencontext-worker-dispatch",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      event_type: "job-queued",
      client_payload: { jobId: "job-123" },
    });
  });

  it("contains transport failures without exposing the token", async () => {
    const logger = { warn: vi.fn() };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`request failed with ${TOKEN}`));

    await expect(
      notifyWorkerJobQueued("job-123", {
        env: {
          GITHUB_WORKER_DISPATCH_TOKEN: TOKEN,
          GITHUB_WORKER_DISPATCH_REPOSITORY: REPOSITORY,
        },
        fetchImpl,
        logger,
      }),
    ).resolves.toEqual({ kind: "FAILED" });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(TOKEN);
  });

  it("dispatches after an upload job commits", async () => {
    const user = await createUser();
    const fetchImpl = successfulFetch();
    vi.stubGlobal("fetch", fetchImpl);
    enableDispatch();

    const job = await createUploadedJob(user.id);

    expect(job.status).toBe("QUEUED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      event_type: "job-queued",
      client_payload: { jobId: job.id },
    });
  });

  it("keeps the upload successful when GitHub returns an error", async () => {
    const user = await createUser();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );
    enableDispatch();

    const job = await createUploadedJob(user.id);

    expect(job.status).toBe("QUEUED");
    expect(await prisma.job.findUnique({ where: { id: job.id } })).not.toBeNull();
    await expect(storage.get(job.sourceKey as string)).resolves.toEqual(TEST_BYTES);
    expect(warn).toHaveBeenCalledWith(
      `Worker dispatch failed for ${REPOSITORY}: GitHub returned HTTP 503`,
    );
  });

  it("dispatches after an automatic requeue", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await claimJob({ workerId: "worker-a" });
    const fetchImpl = successfulFetch();
    vi.stubGlobal("fetch", fetchImpl);
    enableDispatch();

    await requeueJob(job.id, {
      stage: "EXTRACTING",
      attempts: 1,
      workerId: "worker-a",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      client_payload: { jobId: job.id },
    });
  });

  it("dispatches after a manual retry", async () => {
    const user = await createUser();
    const job = await createQueuedJob(user.id);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        failureKind: "TRANSIENT",
        completedAt: new Date(),
      },
    });
    const fetchImpl = successfulFetch();
    vi.stubGlobal("fetch", fetchImpl);
    enableDispatch();

    await expect(retryJob(job.id, user.id)).resolves.toMatchObject({ kind: "OK" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      client_payload: { jobId: job.id },
    });
  });

  it("dispatches after a detail-level rerun", async () => {
    const user = await createUser();
    const sourceKey = `jobs/${randomUUID()}/source.png`;
    await storage.put(sourceKey, testStream(), { sizeBytes: TEST_BYTES.length });
    const original = await prisma.job.create({
      data: {
        userId: user.id,
        displayName: "original.png",
        detailLevel: "LOW",
        status: "COMPLETED",
        sourceKey,
        sourceExt: "png",
        sourceSize: TEST_BYTES.length,
        stageStates: initialStageStates(),
        completedAt: new Date(),
      },
    });
    await prisma.media.create({
      data: {
        jobId: original.id,
        kind: "SOURCE",
        key: sourceKey,
        mime: "image/png",
        sizeBytes: TEST_BYTES.length,
        timestampSec: 0,
      },
    });
    const fetchImpl = successfulFetch();
    vi.stubGlobal("fetch", fetchImpl);
    enableDispatch();

    const result = await rerunJob(original.id, user.id, "HIGH");
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") throw new Error("expected rerun OK");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      client_payload: { jobId: result.job.id },
    });
  });
});
