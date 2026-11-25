import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MultipartPart, Storage, PutOptions, MoveOptions } from "./types";

/**
 * Local-disk storage (dev default, ADR-0004). Objects live under
 * `<root>/<key>`; keys are server-generated and slash-separated
 * (e.g. `incoming/<uuid>`, `jobs/<jobId>/source.mp4`).
 */

const SEPARATOR = "/";
const MULTIPART_UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function safeMultipartUploadId(uploadId: string): string {
  if (!MULTIPART_UPLOAD_ID_PATTERN.test(uploadId)) {
    throw new Error(`Invalid multipart upload id: ${uploadId}`);
  }
  return uploadId;
}

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
      return {
        sizeBytes: info.size,
        contentType: null,
        etag: `${info.size}-${info.mtimeMs}`,
      };
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

  async move(
    fromKey: string,
    toKey: string,
    options: MoveOptions = {},
  ): Promise<void> {
    await this.ensureParent(toKey);
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await this.assertNoSymlinks(from);
    await this.assertNoSymlinks(to);
    if (options.etag) {
      const current = await stat(from);
      const currentEtag = `${current.size}-${current.mtimeMs}`;
      if (currentEtag !== options.etag) {
        throw new Error(`Cannot move ${fromKey}: object changed after validation`);
      }
    }
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

  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.ensureParent(toKey);
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await this.assertNoSymlinks(from);
    await this.assertNoSymlinks(to);
    try {
      await copyFile(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Cannot copy ${fromKey}: source object does not exist`);
      }
      throw error;
    }
  }

  private multipartDir(uploadId: string): string {
    const root = path.resolve(this.root);
    return path.join(root, ".multipart", safeMultipartUploadId(uploadId));
  }

  private multipartPartPath(uploadId: string, partNumber: number): string {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new Error(`Invalid multipart part number: ${partNumber}`);
    }
    return path.join(
      this.multipartDir(uploadId),
      `part-${String(partNumber).padStart(5, "0")}`,
    );
  }

  async initMultipartUpload(
    key: string,
    _contentType: string,
  ): Promise<{ uploadId: string }> {
    void _contentType;
    this.resolve(key);
    const uploadId = randomUUID();
    const dir = this.multipartDir(uploadId);
    await mkdir(dir, { recursive: true });
    await this.assertNoSymlinks(dir);
    return { uploadId };
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
  ): Promise<{ etag: string }> {
    this.resolve(key);
    const dir = this.multipartDir(uploadId);
    await mkdir(dir, { recursive: true });
    await this.assertNoSymlinks(dir);
    const partPath = this.multipartPartPath(uploadId, partNumber);
    await this.assertNoSymlinks(partPath);
    await writeFile(partPath, body);
    const etag = createHash("sha256").update(body).digest("hex");
    return { etag };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    if (parts.length === 0) {
      throw new Error(`Cannot complete multipart upload ${uploadId}: no parts supplied`);
    }
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const dir = this.multipartDir(uploadId);
    await this.assertNoSymlinks(dir);
    const assembledPath = path.join(dir, `assembled-${randomUUID()}.tmp`);
    await this.assertNoSymlinks(assembledPath);

    const handle = await open(assembledPath, "w");
    try {
      for (const part of sorted) {
        const partPath = this.multipartPartPath(uploadId, part.partNumber);
        await this.assertNoSymlinks(partPath);
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(partPath)) {
          const buf = chunk as Buffer;
          hash.update(buf);
          let written = 0;
          while (written < buf.length) {
            const res = await handle.write(buf, written, buf.length - written);
            written += res.bytesWritten;
          }
        }
        const actualEtag = hash.digest("hex");
        if (part.etag && actualEtag !== part.etag) {
          throw new Error(
            `Multipart part ${part.partNumber} checksum mismatch for upload ${uploadId}`,
          );
        }
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(assembledPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();

    await this.ensureParent(key);
    const target = this.resolve(key);
    await this.assertNoSymlinks(target);
    try {
      await rename(assembledPath, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EXDEV" || code === "EPERM") {
        await copyFile(assembledPath, target);
      } else {
        await rm(assembledPath, { force: true }).catch(() => undefined);
        throw error;
      }
    }
    await rm(dir, { recursive: true, force: true });
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    void _key;
    await rm(this.multipartDir(uploadId), { recursive: true, force: true });
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
