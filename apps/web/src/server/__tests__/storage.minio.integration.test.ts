import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: { auth: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: authMock.auth }));

import { POST as completeUploadPost } from "@/app/api/uploads/[id]/complete/route";
import { POST as uploadsPost } from "@/app/api/uploads/route";
import { prisma } from "@/server/db/prisma";
import { resetRateLimits } from "@/server/security/rate-limit";
import { S3Storage, setStorage } from "@/server/storage";
import { getWorkerSourceInfo } from "@/server/worker";
import { createUser, resetDatabase } from "./helpers";

const enabled = process.env.OPENCONTEXT_S3_E2E === "1";

function s3Config() {
  const endpoint = process.env.STORAGE_S3_ENDPOINT;
  const region = process.env.STORAGE_S3_REGION;
  const bucket = process.env.STORAGE_S3_BUCKET;
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 integration environment is incomplete");
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
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
      "testsrc2=size=160x90:rate=1:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000:duration=1",
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
    { stdio: "pipe", timeout: 30_000 },
  );
}

describe.skipIf(!enabled)("S3/MinIO upload integration", () => {
  it("presigns, uploads, completes, and serves the source to the worker", async () => {
    const config = s3Config();
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket })).catch((error) => {
        if ((error as { name?: string }).name !== "BucketAlreadyOwnedByYou") {
          throw error;
        }
      });
      await client.send(
        new PutBucketCorsCommand({
          Bucket: config.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ["https://app.example"],
                AllowedMethods: ["PUT"],
                AllowedHeaders: ["content-type"],
                ExposeHeaders: ["etag"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } finally {
      client.destroy();
    }

    const storage = new S3Storage(config);
    setStorage(storage);
    await resetDatabase();
    await resetRateLimits();
    const user = await createUser();
    authMock.auth.mockResolvedValue({ user: { id: user.id, name: "S3 Test" } });

    const workDir = await mkdtemp(path.join(process.cwd(), "../../.tmp/s3-e2e-"));
    let sourceKey: string | null = null;
    let tempKey: string | null = null;
    try {
      const fixture = path.join(workDir, `fixture-${randomUUID()}.mp4`);
      generateFixture(fixture);
      const source = await readFile(fixture);

      const intentResponse = await uploadsPost(
        new Request("http://test.local/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "s3-fixture.mp4",
            sizeBytes: source.length,
            mime: "video/mp4",
          }),
        }),
      );
      expect(intentResponse.status).toBe(201);
      const intent = (await intentResponse.json()) as {
        uploadId: string;
        url: string;
        headers: Record<string, string>;
      };
      tempKey = (
        await prisma.uploadIntent.findUniqueOrThrow({ where: { id: intent.uploadId } })
      ).tempKey;

      const put = await fetch(intent.url, {
        method: "PUT",
        headers: intent.headers,
        body: source,
      });
      expect(put.status).toBe(200);
      expect((await storage.head(tempKey))?.sizeBytes).toBe(source.length);
      expect((await storage.head(tempKey))?.contentType).toBe("video/mp4");

      const complete = await completeUploadPost(
        new Request(`http://test.local/api/uploads/${intent.uploadId}/complete`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: intent.uploadId }) },
      );
      expect(complete.status).toBe(201);
      const summary = (await complete.json()) as { id: string };
      const job = await prisma.job.findUniqueOrThrow({ where: { id: summary.id } });
      sourceKey = job.sourceKey;
      expect(sourceKey).toBe(`jobs/${job.id}/source.mp4`);
      expect(await storage.head(tempKey)).toBeNull();
      expect(await storage.exists(sourceKey as string)).toBe(true);

      const sourceInfo = await getWorkerSourceInfo(job);
      expect(sourceInfo.provider).toBe("s3");
      const workerSource = await fetch(sourceInfo.uri);
      expect(workerSource.status).toBe(200);
      expect(Buffer.from(await workerSource.arrayBuffer())).toEqual(source);
    } finally {
      const keys = [sourceKey, tempKey].filter((key): key is string => Boolean(key));
      await storage.deleteMany(keys).catch(() => undefined);
      await rm(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
