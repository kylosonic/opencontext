/**
 * Environment access helpers. Reads process.env with safe fallbacks and
 * never logs values (in particular: never logs secrets). Provider and
 * storage selection is env-driven; nothing here touches the network.
 */

export type EnvRecord = Record<string, string | undefined>;
export type StorageProviderKind = "local" | "s3" | "invalid";
export type DatabaseConnectionKind = "postgres" | "sqlite" | "invalid";

export function isConfiguredValue(value: string | undefined): boolean {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== "change-me");
}

export function isStrongSecret(value: string | undefined, minimumLength: number): boolean {
  return isConfiguredValue(value) && value!.trim().length >= minimumLength;
}

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
export function storageProviderKind(
  env: EnvRecord = process.env,
): StorageProviderKind {
  const value = env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (!value || value === "local") {
    return "local";
  }
  if (value === "s3") {
    return "s3";
  }
  return "invalid";
}

export function storageProvider(): "local" | "s3" {
  const kind = storageProviderKind();
  return kind === "s3" ? "s3" : "local";
}

/** Database connection string. Dev default is a local SQLite file. */
export function databaseUrl(): string {
  return getEnv("DATABASE_URL", "file:./dev.db") ?? "file:./dev.db";
}

export function databaseConnectionKind(
  env: EnvRecord = process.env,
): DatabaseConnectionKind {
  const value = env.DATABASE_URL?.trim();
  if (!value) {
    return "sqlite";
  }
  if (/^postgres(?:ql)?:\/\//.test(value)) {
    return "postgres";
  }
  if (value.startsWith("file:")) {
    return "sqlite";
  }
  return "invalid";
}

/** Local-disk storage root directory (STORAGE_PROVIDER=local). */
export function storagePath(): string {
  return getEnv("STORAGE_PATH", "storage") ?? "storage";
}

/** S3-compatible storage configuration. */
export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional public base URL for serving objects directly. */
  publicBaseUrl?: string;
}

export const S3_REQUIRED_KEYS = [
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
] as const;

export function s3ConfigFromEnv(env: EnvRecord = process.env): S3Config | undefined {
  if (!S3_REQUIRED_KEYS.every((key) => isConfiguredValue(env[key]))) {
    return undefined;
  }
  return {
    endpoint: env.STORAGE_S3_ENDPOINT!.trim(),
    region: env.STORAGE_S3_REGION!.trim(),
    bucket: env.STORAGE_S3_BUCKET!.trim(),
    accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY!.trim(),
    publicBaseUrl: env.STORAGE_S3_PUBLIC_BASE_URL?.trim() || undefined,
  };
}

/** S3 configuration. Throws only when STORAGE_PROVIDER=s3 and config is missing. */
export function s3Config(): S3Config | undefined {
  return s3ConfigFromEnv();
}

/**
 * Worker API shared secret (ADR-0005). When unset, all worker endpoints
 * reject requests with WORKER_UNAUTHORIZED.
 */
export function workerApiToken(): string | undefined {
  return getEnv("WORKER_API_TOKEN");
}

/**
 * Auth.js session secret. A fixed dev fallback keeps the app bootable
 * (and buildable) without env. In production a missing AUTH_SECRET logs
 * a one-time warning — deployments MUST set it (session tokens are only
 * as strong as this secret), but nothing crashes so builds and local
 * runs work out of the box.
 */
export function authSecret(): string {
  const value = getEnv("AUTH_SECRET");
  if (value) {
    return value;
  }
  if (process.env.NODE_ENV === "production") {
    warnOnce(
      "AUTH_SECRET is not set — using an insecure dev fallback. Set AUTH_SECRET in production.",
    );
  }
  return "opencontext-dev-auth-secret-do-not-use-in-production";
}

const warned: Record<string, true> = {};
function warnOnce(message: string): void {
  if (!warned[message]) {
    warned[message] = true;
    console.warn(`[opencontext] ${message}`);
  }
}

export interface GitHubAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * GitHub OAuth configuration. GitHub sign-in is only offered when both
 * values are present; otherwise the app boots with an empty providers
 * array and the sign-in page shows an honest "not configured" notice.
 */
export function authGithub(): GitHubAuthConfig | undefined {
  const clientId = getEnv("AUTH_GITHUB_ID");
  const clientSecret = getEnv("AUTH_GITHUB_SECRET");
  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }
  return undefined;
}

/** True when GitHub sign-in is fully configured. */
export function authGithubConfigured(): boolean {
  return authGithub() !== undefined;
}

/**
 * Explicit opt-in development identity. This is never enabled by default.
 * Compose and local quick-start documentation set it to true to avoid
 * requiring a GitHub OAuth app for the first upload.
 */
export function devAuthEnabled(): boolean {
  return getEnvBoolean("DEV_AUTH_ENABLED", false);
}

export function devAuthEmail(): string {
  return getEnv("DEV_AUTH_EMAIL", "local@opencontext.dev") ?? "local@opencontext.dev";
}

export interface HttpProviderConfig {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/**
 * Vision provider selection (blueprint §4 ANALYZING).
 * VISION_PROVIDER ∈ { openai_compatible, ollama, none }.
 */
export function visionProvider(): HttpProviderConfig {
  const provider = getEnv("VISION_PROVIDER", "none") ?? "none";
  return {
    provider,
    baseUrl: getEnv("VISION_BASE_URL"),
    apiKey: getEnv("VISION_API_KEY"),
    model: getEnv("VISION_MODEL"),
  };
}

/**
 * Transcription provider selection (blueprint §4 TRANSCRIBING).
 * TRANSCRIPTION_PROVIDER ∈ { openai_compatible, faster_whisper, none }.
 */
export function transcriptionProvider(): HttpProviderConfig {
  const provider = getEnv("TRANSCRIPTION_PROVIDER", "none") ?? "none";
  return {
    provider,
    baseUrl: getEnv("TRANSCRIPTION_BASE_URL"),
    apiKey: getEnv("TRANSCRIPTION_API_KEY"),
    model: getEnv("TRANSCRIPTION_MODEL"),
  };
}

/**
 * Text provider selection (blueprint §4 GENERATING_CONTEXT, optional
 * refinement; template fallback when absent).
 */
export function textProvider(): HttpProviderConfig {
  const provider = getEnv("TEXT_PROVIDER", "none") ?? "none";
  return {
    provider,
    baseUrl: getEnv("TEXT_BASE_URL"),
    apiKey: getEnv("TEXT_API_KEY"),
    model: getEnv("TEXT_MODEL"),
  };
}

/** Public base URL of this deployment (used to build worker media URIs). */
export function appBaseUrl(): string {
  return getEnv("APP_BASE_URL", "") ?? "";
}

export function deploymentEnvironment(
  env: EnvRecord = process.env,
): "production" | "preview" | "development" {
  if (env.VERCEL_ENV === "production") {
    return "production";
  }
  if (env.VERCEL_ENV === "preview" || env.VERCEL === "1") {
    return "preview";
  }
  if (env.NODE_ENV === "production") {
    return "production";
  }
  return "development";
}
