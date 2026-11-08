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
import type { S3Config } from "@opencontext/config";
import type { Storage, PutOptions } from "./types";

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
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
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
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    return (response.Body as ReadableStream<Uint8Array> | null) ?? null;
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${fromKey}`,
        Key: toKey,
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
    expiresInSec = 900,
  ): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
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
    if (keys.length === 0) {
      return;
    }
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((key) => ({ Key: key })) },
      }),
    );
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
