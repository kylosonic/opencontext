import {
  databaseConnectionKind,
  isConfiguredValue,
  isStrongSecret,
  s3ConfigFromEnv,
  storageProviderKind,
  type EnvRecord,
} from "@opencontext/config";
import type {
  DeploymentEnvironment,
  ReadinessCheck,
  ReadinessResponse,
} from "@opencontext/schemas";

export { deploymentEnvironment } from "@opencontext/config";

export type ReadinessReport = Pick<
  ReadinessResponse,
  "ready" | "environment" | "checks"
>;

type Env = EnvRecord;

function present(env: Env, key: string): boolean {
  return isConfiguredValue(env[key]);
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
  const databaseKind = databaseConnectionKind(env);
  const databaseOk =
    strict ? databaseKind === "postgres" : databaseKind !== "invalid";

  const authSecret =
    present(env, "AUTH_SECRET") &&
    (!strict || isStrongSecret(env.AUTH_SECRET, 32));
  const github = present(env, "AUTH_GITHUB_ID") && present(env, "AUTH_GITHUB_SECRET");
  const devAuth = !strict && env.DEV_AUTH_ENABLED?.toLowerCase() === "true";
  const authOk = authSecret && (github || devAuth);

  const provider = storageProviderKind(env);
  const storageOk = strict
    ? provider === "s3" && s3ConfigFromEnv(env) !== undefined
    : provider === "local" ||
      (provider === "s3" && s3ConfigFromEnv(env) !== undefined);
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
        ? "AUTH_SECRET is missing, too short, or still a placeholder"
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
