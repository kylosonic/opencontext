import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import type { S3Config } from "@opencontext/config";
import type { MoveOptions, Storage, PutOptions } from "./types";

/**
 * S3-compatible object storage (ADR-0004) via @aws-sdk/client-s3 — covers
 * AWS S3 and Cloudflare R2 through a custom endpoint. Used in production;
 * configuration comes from STORAGE_S3_* environment variables.
 */
export class S3Storage implements Storage {
  readonly provider = "s3" as const;
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      // Streaming artifact bodies cannot be re-read for optional CRC
      // checksums; S3 does not require them, so only calculate when required.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials:
        config.credentials.kind === "vercel-oidc"
          ? awsCredentialsProvider({
              roleArn: config.credentials.roleArn,
              clientConfig: { region: config.region },
            })
          : {
              accessKeyId: config.credentials.accessKeyId,
              secretAccessKey: config.credentials.secretAccessKey,
            },
    });
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        // The SDK's Node HTTP handler only accepts Node streams/buffers, not
        // the web ReadableStream produced by request.formData().
        Body: Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
        ContentType: options.contentType,
        ContentLength: options.sizeBytes,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      return bytes ?? null;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async head(key: string) {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType ?? null,
        etag: response.ETag ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const body = response.Body as
        | { transformToWebStream?: () => ReadableStream<Uint8Array> }
        | null
        | undefined;
      return body?.transformToWebStream?.() ?? null;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async move(fromKey: string, toKey: string, options: MoveOptions = {}): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${fromKey}`,
        Key: toKey,
        ...(options.etag ? { CopySourceIfMatch: options.etag } : {}),
      }),
    );
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: fromKey }),
    );
  }

  async presign(key: string, expiresInSec = 900): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
  }

  async presignPut(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresInSec = 900,
  ): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: expiresInSec },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async deleteMany(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)];
    for (let offset = 0; offset < unique.length; offset += 1000) {
      const chunk = unique.slice(offset, offset + 1000);
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: chunk.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
      const errors = result.Errors ?? [];
      if (errors.length > 0) {
        throw new Error(
          `S3 rejected ${errors.length} object deletion(s): ${errors
            .slice(0, 3)
            .map((entry) => `${entry.Key ?? "?"}:${entry.Code ?? "unknown"}`)
            .join(", ")}`,
        );
      }
    }
  }

  /** Verify an object exists (used by tests; object presence = truth). */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === "NoSuchKey" || name === "NotFound" || name === "404";
}
