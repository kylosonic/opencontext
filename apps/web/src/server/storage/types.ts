/**
 * Storage abstraction contract (ADR-0004): local disk (dev, default) and
 * S3-compatible object storage (production). All media/artifact reads and
 * writes go through this interface; nothing else touches the filesystem
 * or buckets. Only object references (`key`) ever enter the database.
 */

export type StorageProviderKind = "local" | "s3";

export interface PutOptions {
  contentType?: string;
  sizeBytes: number;
}

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | null;
}

export interface Storage {
  readonly provider: StorageProviderKind;

  /**
   * Write `body` (a web ReadableStream of bytes) to `key`. Implementations
   * must enforce the declared size where the sink is not size-checked.
   */
  put(key: string, body: ReadableStream<Uint8Array>, options: PutOptions): Promise<void>;

  /** Read the full object (bounded by callers to known-size objects). */
  get(key: string): Promise<Uint8Array | null>;

  /** Return stored-object metadata without downloading the body. */
  head(key: string): Promise<StoredObjectInfo | null>;

  /** Open a streaming read. Returns null when the object does not exist. */
  stream(key: string): Promise<ReadableStream<Uint8Array> | null>;

  /**
   * Move `fromKey` to `toKey` atomically where the backend supports it
   * (rename for local disk; copy+delete for S3). Used by the upload
   * commit sequence (blueprint §3 B3).
   */
  move(fromKey: string, toKey: string): Promise<void>;

  /**
   * Produce a directly-fetchable URI for a key. S3 returns a presigned
   * URL; local disk returns null (callers use GET /api/worker/media/[key]
   * with the worker token instead).
   */
  presign(key: string, expiresInSec?: number): Promise<string | null>;

  /**
   * Presigned direct upload URL. Local disk returns null and the route
   * provides a session-authenticated proxy URL instead.
   */
  presignPut(
    key: string,
    contentType: string,
    expiresInSec?: number,
  ): Promise<string | null>;

  delete(key: string): Promise<void>;

  deleteMany(keys: string[]): Promise<void>;
}
