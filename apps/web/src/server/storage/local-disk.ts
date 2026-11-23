import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
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
  if (/[\0\r\n]/.test(key) || path.isAbsolute(key) || /^[A-Za-z]:/.test(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  const segments = key
    .replaceAll("\\", SEPARATOR)
    .split(SEPARATOR)
    .filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return segments.join(SEPARATOR);
}

export class LocalDiskStorage implements Storage {
  readonly provider = "local" as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const root = path.resolve(this.root);
    const target = path.resolve(root, safeKey(key));
    const relative = path.relative(root, target);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  }

  private async ensureParent(key: string): Promise<void> {
    const root = path.resolve(this.root);
    await mkdir(root, { recursive: true });
    const parent = path.dirname(this.resolve(key));
    await mkdir(parent, { recursive: true });
    await this.assertNoSymlinks(parent);
  }

  private async assertNoSymlinks(target: string): Promise<void> {
    const root = path.resolve(this.root);
    const relative = path.relative(root, target);
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) {
          throw new Error(`Invalid storage path: symlink at ${current}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
  }

  async put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<void> {
    await this.ensureParent(key);
    await this.assertNoSymlinks(this.resolve(key));
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
    const target = this.resolve(key);
    try {
      await this.assertNoSymlinks(target);
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async head(key: string) {
    const target = this.resolve(key);
    try {
      await this.assertNoSymlinks(target);
      const info = await stat(target);
      if (!info.isFile()) {
        return null;
      }
      return { sizeBytes: info.size, contentType: null, etag: null };
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
      await this.assertNoSymlinks(target);
      const info = await stat(target);
      if (!info.isFile()) {
        return null;
      }
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
    await this.assertNoSymlinks(from);
    await this.assertNoSymlinks(to);
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

  async presignPut(
    _key: string,
    _contentType: string,
    _sizeBytes: number,
    _expiresInSec?: number,
  ): Promise<string | null> {
    void _key;
    void _contentType;
    void _sizeBytes;
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
