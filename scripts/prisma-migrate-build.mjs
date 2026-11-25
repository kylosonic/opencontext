import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const POSTGRES_URL_ENV_PRIORITY = [
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
];

const TRUTHY_FLAGS = new Set(["true", "1", "yes", "on"]);
const FALSY_FLAGS = new Set(["false", "0", "no", "off"]);

/**
 * Check whether a string uses a PostgreSQL connection scheme.
 */
export function isPostgresUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://");
}

/**
 * Strip Neon's `-pooler` endpoint suffix so Prisma advisory locks run on a direct connection.
 */
export function deriveDirectNeonUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: rawUrl, derived: false };
  }
  const hostname = parsed.hostname.toLowerCase();
  const hostParts = parsed.hostname.split(".");
  if (
    hostname.endsWith(".neon.tech") &&
    hostParts.length >= 3 &&
    hostParts[0].endsWith("-pooler")
  ) {
    hostParts[0] = hostParts[0].slice(0, -"-pooler".length);
    parsed.hostname = hostParts.join(".");
    return { url: parsed.toString(), derived: true };
  }
  return { url: rawUrl, derived: false };
}

/**
 * Resolve the PostgreSQL URL used for build-time migrations, preferring direct/unpooled URLs.
 */
export function resolvePostgresMigrationUrl(env = process.env) {
  for (const key of POSTGRES_URL_ENV_PRIORITY) {
    const raw = env[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!isPostgresUrl(trimmed)) continue;

    if (key === "DATABASE_URL") {
      const direct = deriveDirectNeonUrl(trimmed);
      return {
        url: direct.url,
        source: direct.derived ? "DATABASE_URL (neon direct)" : "DATABASE_URL",
      };
    }

    return { url: trimmed, source: key };
  }

  return { url: null, source: null };
}

/**
 * Decide whether PostgreSQL migrations should run automatically during web build.
 */
export function shouldRunBuildMigrations(env = process.env) {
  const rawFlag =
    typeof env.PRISMA_MIGRATE_ON_BUILD === "string"
      ? env.PRISMA_MIGRATE_ON_BUILD.trim()
      : "";
  const flag = rawFlag.toLowerCase();

  if (FALSY_FLAGS.has(flag)) {
    return { run: false, reason: "disabled by PRISMA_MIGRATE_ON_BUILD", urlSource: null };
  }

  if (TRUTHY_FLAGS.has(flag)) {
    const { url, source } = resolvePostgresMigrationUrl(env);
    if (!url) {
      throw new Error(
        "PRISMA_MIGRATE_ON_BUILD is enabled, but no PostgreSQL connection URL is configured.",
      );
    }
    return { run: true, reason: "enabled by PRISMA_MIGRATE_ON_BUILD", urlSource: source };
  }

  if (rawFlag.length > 0) {
    throw new Error(`Invalid PRISMA_MIGRATE_ON_BUILD value: "${rawFlag}"`);
  }

  const isVercel =
    env.VERCEL === "1" ||
    (typeof env.VERCEL === "string" && env.VERCEL.trim().toLowerCase() === "true");
  const vercelEnv =
    typeof env.VERCEL_ENV === "string" ? env.VERCEL_ENV.trim().toLowerCase() : "";

  if (isVercel && vercelEnv === "production") {
    const { url, source } = resolvePostgresMigrationUrl(env);
    if (url) {
      return {
        run: true,
        reason: "Vercel production deployment with PostgreSQL",
        urlSource: source,
      };
    }
    return {
      run: false,
      reason: "Vercel production deployment has no PostgreSQL URL configured",
      urlSource: null,
    };
  }

  if (isVercel) {
    return {
      run: false,
      reason: `Vercel ${vercelEnv || "non-production"} deployment (set PRISMA_MIGRATE_ON_BUILD=true to opt in)`,
      urlSource: null,
    };
  }

  return {
    run: false,
    reason: "not a Vercel production deployment (set PRISMA_MIGRATE_ON_BUILD=true to opt in)",
    urlSource: null,
  };
}

function runCli() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const webDir = path.join(repoRoot, "apps", "web");

  for (const envFile of [path.join(webDir, ".env.local"), path.join(webDir, ".env")]) {
    if (existsSync(envFile)) {
      loadEnv({ path: envFile, override: false, quiet: true });
    }
  }

  const decision = shouldRunBuildMigrations(process.env);
  if (!decision.run) {
    console.log(
      `[prisma-migrate-build] Skipping build-time PostgreSQL migrations (${decision.reason}).`,
    );
    return;
  }

  console.log(
    `[prisma-migrate-build] Running PostgreSQL migrations (${decision.reason}; connection via ${decision.urlSource}).`,
  );

  const prismaEntry = [
    path.join(webDir, "node_modules", "prisma", "build", "index.js"),
    path.join(repoRoot, "node_modules", "prisma", "build", "index.js"),
  ].find((candidate) => existsSync(candidate));

  if (!prismaEntry) {
    console.error("Could not locate the Prisma CLI. Run npm install first.");
    process.exit(1);
  }

  const run = (args) => {
    const result = spawnSync(process.execPath, args, {
      cwd: webDir,
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  };

  run([path.join(repoRoot, "scripts", "prisma-schema.mjs"), "postgresql"]);
  run([prismaEntry, "migrate", "deploy", "--config", "prisma.postgres.config.ts"]);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCli();
}
