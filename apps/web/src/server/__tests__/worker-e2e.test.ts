import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkerArtifactFieldsSchema,
  WorkerClaimRequestSchema,
  WorkerFailRequestSchema,
  WorkerProgressRequestSchema,
  WorkerStageResultRequestSchema,
} from "@opencontext/schemas";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { POST as uploadsPost } from "@/app/api/uploads/route";
import { PUT as uploadBodyPut } from "@/app/api/uploads/[id]/body/route";
import { POST as uploadCompletePost } from "@/app/api/uploads/[id]/complete/route";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";
import { jobToDetail } from "@/server/jobs";
import { applyProgress, applyStageResult, getWorkerSourceInfo, storeArtifact } from "@/server/worker";
import { claimJob, completeJob, failJob } from "@/server/queue";
import { createUser, resetDatabase, resetStorage } from "./helpers";
import { findWorkerPython, REPO_ROOT, workerPythonEnv } from "./python-process";
import { resetRateLimits } from "@/server/security/rate-limit";

const python = findWorkerPython();
const ffmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
})();

type JsonBody = Record<string, unknown>;

function respond(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": bytes.length,
  });
  res.end(bytes);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<JsonBody> {
  return JSON.parse((await readBody(req)).toString("utf8")) as JsonBody;
}

function claimedJobId(pathname: string): string | null {
  const match = /^\/api\/worker\/jobs\/([^/]+)\//.exec(pathname);
  return match?.[1] ?? null;
}

async function runningJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`Missing e2e job ${jobId}`);
  }
  return job;
}

function assertWorkerAuth(req: IncomingMessage): void {
  if (req.headers.authorization !== `Bearer ${process.env.WORKER_API_TOKEN}`) {
    throw new Error("Worker authorization header is missing or invalid");
  }
}

function createWorkerServer() {
  return createServer(async (req, res) => {
    try {
      assertWorkerAuth(req);
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = url.pathname;

      if (req.method === "POST" && pathname === "/api/worker/jobs/claim") {
        const parsed = WorkerClaimRequestSchema.parse(await readJson(req));
        const job = await claimJob({ workerId: parsed.workerId });
        if (!job) {
          respond(res, 204);
          return;
        }
        respond(res, 200, { job: jobToDetail(job), source: await getWorkerSourceInfo(job) });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/api/worker/media/")) {
        const key = pathname.slice("/api/worker/media/".length);
        const bytes = await storage.get(key);
        if (!bytes) {
          respond(res, 404, { error: { code: "NOT_FOUND", message: "missing" } });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
        });
        res.end(Buffer.from(bytes));
        return;
      }

      const jobId = claimedJobId(pathname);
      if (!jobId) {
        respond(res, 404, { error: { code: "NOT_FOUND", message: "unknown route" } });
        return;
      }

      if (req.method === "GET" && pathname.endsWith("/source")) {
        respond(res, 200, await getWorkerSourceInfo(await runningJob(jobId)));
        return;
      }
      if (req.method === "POST" && pathname.endsWith("/progress")) {
        const input = WorkerProgressRequestSchema.parse(await readJson(req));
        respond(res, 200, await applyProgress(await runningJob(jobId), input));
        return;
      }
      if (req.method === "POST" && pathname.endsWith("/artifacts")) {
        const raw = await readBody(req);
        const request = new Request(url, {
          method: "POST",
          headers: req.headers as Record<string, string>,
          body: new Uint8Array(raw),
        });
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          respond(res, 400, { error: { code: "VALIDATION_ERROR", message: "missing file" } });
          return;
        }
        const fields = WorkerArtifactFieldsSchema.parse({
          kind: form.get("kind"),
          timestampSec: form.get("timestampSec") ?? undefined,
        });
        respond(
          res,
          200,
          await storeArtifact(await runningJob(jobId), {
            kind: fields.kind,
            timestampSec: fields.timestampSec,
            filename: file.name,
            mime: file.type,
            sizeBytes: file.size,
            body: file.stream(),
          }),
        );
        return;
      }
      if (req.method === "POST" && pathname.endsWith("/stage-result")) {
        const input = WorkerStageResultRequestSchema.parse(await readJson(req));
        respond(res, 200, await applyStageResult(await runningJob(jobId), input));
        return;
      }
      if (req.method === "POST" && pathname.endsWith("/complete")) {
        const workerId = String(req.headers["x-worker-id"] ?? "");
        const result = await completeJob(jobId, workerId);
        if (result.kind !== "OK") {
          respond(res, 409, { error: { code: "CONFLICT", message: result.kind } });
          return;
        }
        respond(res, 200, result.job);
        return;
      }
      if (req.method === "POST" && pathname.endsWith("/fail")) {
        const workerId = String(req.headers["x-worker-id"] ?? "");
        const input = WorkerFailRequestSchema.parse(await readJson(req));
        respond(res, 200, await failJob(jobId, workerId, input));
        return;
      }

      respond(res, 404, { error: { code: "NOT_FOUND", message: "unknown route" } });
    } catch (error) {
      respond(res, 500, {
        error: { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}

function generateFixture(output: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=1:duration=3",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=3",
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      output,
    ],
    { stdio: "pipe", timeout: 60_000 },
  );
}

async function runWorkerOnce(apiUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python as string, ["-m", "oc_worker.main", "--once"], {
      cwd: REPO_ROOT,
      env: workerPythonEnv({
        WORKER_API_URL: apiUrl,
        WORKER_API_TOKEN: process.env.WORKER_API_TOKEN,
        WORKER_ID: "e2e-worker",
        TRANSCRIPTION_PROVIDER: "fixture",
        VISION_PROVIDER: "fixture",
        TEXT_PROVIDER: "template",
        FIXTURE_TRANSCRIPT: "Synthetic integration transcript.",
        FIXTURE_VISIBLE_TEXT: "OpenContext integration fixture",
      }),
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`worker exited ${code}\n${stderr}`));
      }
    });
  });
}

beforeEach(async () => {
  authMock.auth.mockReset();
  await resetDatabase();
  await resetStorage();
  resetRateLimits();
});

afterEach(async () => {
  await resetStorage();
});

describe.skipIf(!python || !ffmpeg)("local end-to-end job", () => {
  it("uploads, queues, extracts, analyzes, persists context and artifacts", async () => {
    const user = await createUser();
    authMock.auth.mockResolvedValue({ user: { id: user.id, name: "Test User" } });

    const workDir = path.join(REPO_ROOT, ".tmp", "node-e2e");
    mkdirSync(workDir, { recursive: true });
    const fixturePath = path.join(workDir, "opencontext-fixture.mp4");
    generateFixture(fixturePath);
    const source = readFileSync(fixturePath);

    const intentResponse = await uploadsPost(
      new Request("http://test.local/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "fixture.mp4",
          sizeBytes: source.length,
          mime: "video/mp4",
          detailLevel: "MEDIUM",
        }),
      }),
    );
    expect(intentResponse.status).toBe(201);
    const intent = (await intentResponse.json()) as {
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    };
    const putResponse = await uploadBodyPut(
      new Request(`http://test.local${intent.url}`, {
        method: "PUT",
        headers: {
          "Content-Type": intent.headers["Content-Type"],
          "Content-Length": String(source.length),
        },
        body: new Uint8Array(source),
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(putResponse.status).toBe(204);
    const upload = await uploadCompletePost(
      new Request(`http://test.local/api/uploads/${intent.uploadId}/complete`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: intent.uploadId }) },
    );
    expect(upload.status).toBe(201);
    const summary = (await upload.json()) as { id: string; status: string };
    expect(summary.status).toBe("QUEUED");

    const server = createWorkerServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("worker test server has no TCP address");
    }
    try {
      await runWorkerOnce(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }

    const job = await runningJob(summary.id);
    expect(job.status).toBe("COMPLETED");
    expect(job.progress).toBe(100);
    expect(job.durationSec).toBeGreaterThan(0);
    expect(job.audioPresent).toBe(true);
    expect(job.frameCount).toBeGreaterThan(0);

    const [segments, observations, ocr, media, result] = await Promise.all([
      prisma.transcriptSegment.findMany({ where: { jobId: job.id } }),
      prisma.visualObservation.findMany({ where: { jobId: job.id } }),
      prisma.ocrObservation.findMany({ where: { jobId: job.id } }),
      prisma.media.findMany({ where: { jobId: job.id } }),
      prisma.processingResult.findUnique({ where: { jobId: job.id } }),
    ]);
    expect(segments.map((segment) => segment.text)).toContain(
      "Synthetic integration transcript.",
    );
    expect(observations.length).toBeGreaterThan(0);
    expect(ocr.map((item) => item.text)).toContain("OpenContext integration fixture");
    expect(media.filter((item) => item.kind === "AUDIO").length).toBeGreaterThan(0);
    expect(media.filter((item) => item.kind === "FRAME").length).toBeGreaterThan(0);

    expect(result).not.toBeNull();
    expect(result?.markdown).toContain("Synthetic integration transcript.");
    expect(result?.markdown).toContain("OpenContext integration fixture");
    const payload = result?.json as { evidence?: unknown[]; timeline?: unknown[] };
    expect(payload.evidence?.length).toBeGreaterThan(0);
    expect(payload.timeline?.length).toBeGreaterThan(0);
  }, 120_000);
});
