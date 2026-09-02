/**
 * Tiny environment access helpers. Reads process.env with safe fallbacks and
 * never logs values (in particular: never logs secrets). Real provider wiring
 * lands in later slices.
 */

/** Read a string environment variable with an optional fallback. */
export function getEnv(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  if (value !== undefined && value !== "") {
    return value;
  }
  return fallback;
}

/** Read a required string environment variable, throwing when it is missing. */
export function getEnvOrThrow(key: string): string {
  const value = getEnv(key);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/** Read a numeric environment variable, falling back on parse errors. */
export function getEnvNumber(key: string, fallback: number): number {
  const value = getEnv(key);
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a boolean environment variable (true/false/1/0), falling back otherwise. */
export function getEnvBoolean(key: string, fallback: boolean): boolean {
  const value = getEnv(key)?.toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return fallback;
}

/** Storage backend selection: "local" filesystem or "s3"-compatible object storage. */
export function storageProvider(): "local" | "s3" {
  const value = getEnv("STORAGE_PROVIDER", "local")?.toLowerCase();
  return value === "s3" ? "s3" : "local";
}

/** Database connection string. Dev default is a local SQLite file. */
export function databaseUrl(): string {
  return getEnv("DATABASE_URL", "file:./dev.db") ?? "file:./dev.db";
}
