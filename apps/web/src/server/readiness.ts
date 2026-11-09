export interface ReadinessCheck {
  id:
    | "database"
    | "auth"
    | "storage"
    | "worker"
    | "publicUrl"
    | "rateLimit";
  ok: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  environment: DeploymentEnvironment;
  checks: ReadinessCheck[];
}

type Env = Record<string, string | undefined>;
export type DeploymentEnvironment = "production" | "preview" | "development";

const S3_KEYS = [
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
] as const;

function present(env: Env, key: string): boolean {
  const value = env[key]?.trim();
  return Boolean(value && value !== "change-me");
}

function completeS3(env: Env): boolean {
  return S3_KEYS.every((key) => present(env, key));
}

function httpsUrl(env: Env): boolean {
  const value = env.APP_BASE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Report whether the web deployment has the minimum configuration needed to
 * accept and process jobs. This checks presence only; it does not probe remote
 * services or expose configured values.
 */
export function evaluateReadiness(
  env: Env,
  environment: DeploymentEnvironment,
): ReadinessReport {
  const strict = environment !== "development";
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const postgres = /^postgres(?:ql)?:\/\//.test(databaseUrl);
  const databaseOk = strict ? postgres : true;

  const authSecret = present(env, "AUTH_SECRET");
  const github = present(env, "AUTH_GITHUB_ID") && present(env, "AUTH_GITHUB_SECRET");
  const devAuth = !strict && env.DEV_AUTH_ENABLED?.toLowerCase() === "true";
  const authOk = authSecret && (github || devAuth);

  const provider = env.STORAGE_PROVIDER?.trim().toLowerCase();
  const storageOk = strict ? provider === "s3" && completeS3(env) : provider !== "s3" || completeS3(env);
  const publicUrlOk = strict ? httpsUrl(env) : true;
  const workerToken = env.WORKER_API_TOKEN?.trim() ?? "";
  const workerOk = workerToken.length >= 16 && workerToken !== "change-me";
  const rateLimitOk =
    !strict || env.RATE_LIMIT_BACKEND?.trim().toLowerCase() === "database";

  const checks: ReadinessCheck[] = [
    {
      id: "database",
      ok: databaseOk,
      detail: databaseOk
        ? strict
          ? "PostgreSQL URL configured"
          : "Development database configured"
        : "DATABASE_URL must use a PostgreSQL URL",
    },
    {
      id: "auth",
      ok: authOk,
      detail: !authSecret
        ? "AUTH_SECRET is missing or still a placeholder"
        : !github && !devAuth
          ? "GitHub OAuth credentials are not configured"
          : "Session authentication configured",
    },
    {
      id: "storage",
      ok: storageOk,
      detail: storageOk
        ? provider === "s3"
          ? "S3-compatible storage configured"
          : "Development local storage enabled"
        : "S3 storage is selected but one or more required settings are missing",
    },
    {
      id: "worker",
      ok: workerOk,
      detail: workerOk
        ? "Worker API token configured"
        : "WORKER_API_TOKEN is missing or too short",
    },
    {
      id: "publicUrl",
      ok: publicUrlOk,
      detail: publicUrlOk
        ? strict
          ? "Public HTTPS URL configured"
          : "Public URL is optional in development"
        : "APP_BASE_URL or NEXT_PUBLIC_APP_URL must be an HTTPS URL",
    },
    {
      id: "rateLimit",
      ok: rateLimitOk,
      detail: rateLimitOk
        ? strict
          ? "Shared database rate limiting configured"
          : "Development rate limiting configured"
        : "RATE_LIMIT_BACKEND must be database in production",
    },
  ];

  return {
    ready: checks.every((check) => check.ok),
    environment,
    checks,
  };
}

export function deploymentEnvironment(env: Env): DeploymentEnvironment {
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
