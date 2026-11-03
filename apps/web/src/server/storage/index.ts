import path from "node:path";
import { s3Config, storagePath, storageProvider } from "@opencontext/config";
import { LocalDiskStorage } from "./local-disk";
import { S3Storage } from "./s3";
import type { Storage } from "./types";

export type { Storage, StorageProviderKind, PutOptions } from "./types";
export { LocalDiskStorage } from "./local-disk";
export { S3Storage } from "./s3";

let instance: Storage | undefined;

/**
 * Process-wide storage instance selected by env (ADR-0004):
 * STORAGE_PROVIDER=local → local disk under STORAGE_PATH (default);
 * STORAGE_PROVIDER=s3 → S3-compatible storage from STORAGE_S3_*.
 */
export function getStorage(): Storage {
  if (instance) {
    return instance;
  }
  const provider = storageProvider();
  if (provider === "s3") {
    const config = s3Config();
    if (!config) {
      throw new Error(
        "STORAGE_PROVIDER=s3 requires STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY",
      );
    }
    instance = new S3Storage(config);
  } else {
    instance = new LocalDiskStorage(
      path.resolve(/* turbopackIgnore: true */ process.cwd(), storagePath()),
    );
  }
  return instance;
}

/** Rebind the singleton (tests). */
export function setStorage(storage: Storage): void {
  instance = storage;
}

/**
 * Lazy storage handle: resolves the provider on first use so importing
 * this module never throws (important when STORAGE_PROVIDER env is
 * unset or invalid at import time).
 */
export const storage: Storage = new Proxy({} as Storage, {
  get(_target, prop, receiver) {
    const resolved = getStorage();
    return Reflect.get(resolved, prop, receiver);
  },
});
