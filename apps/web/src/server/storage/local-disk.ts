import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Storage, PutOptions } from "./types";

/**
 * Local-disk storage (dev default, ADR-0004). Objects live under
 * `<root>/<key>`; keys are server-generated and slash-separated
 * (e.g. `incoming/<uuid>`, `jobs/<jobId>/source.mp4`).
 */

const SEPARATOR = "/";

function safeKey(key: string): string {
  // Keys are server-generated, but refuse traversal as defense in depth.
  const normalized = key.replaceAll("\\", SEPARATOR).split(SEPARATOR).filter(Boolean).join(SEPARATOR);
  if (!normalized || normalized.startsWith("..") || normalized.includes(`..${SEPARATOR}`)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return normalized;
}

export class LocalDiskStorage implements Storage {
  readonly provider = "local" as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    return path.resolve(this.root, safeKey(key));
  }

  private async ensureParent(key: string): Promise<void> {
    await mkdir(path.dirname(this.resolve(key)), { recursive: true });
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<void> {
    await this.ensureParent(key);
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(null, chunk);
      },
    });
    const nodeReadable = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(nodeReadable, counter, createWriteStream(this.resolve(key)));
    if (received !== options.sizeBytes) {
      // Truncated or oversized transfer — remove the partial object.
      await rm(this.resolve(key), { force: true });
      throw new Error(
        `Storage write size mismatch for ${key}: expected ${options.sizeBytes}, received ${received}`,
      );
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const target = this.resolve(key);
    try {
      await stat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
    return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    await this.ensureParent(toKey);
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    try {
      await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(`Cannot move ${fromKey}: source object does not exist`);
      }
      if (code === "EXDEV" || code === "EPERM") {
        // Some Windows and sandboxed environments reject rename within a volume.
        await copyFile(from, to);
        await rm(from, { force: true });
        return;
      }
      throw error;
    }
  }

  async presign(_key: string, _expiresInSec?: number): Promise<string | null> {
    void _key;
    void _expiresInSec;
    return null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }
}
