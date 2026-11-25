import "dotenv/config";
import { defineConfig } from "prisma/config";

function isPostgresUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://");
}

function deriveDirectNeonUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const hostParts = parsed.hostname.split(".");
    if (
      parsed.hostname.toLowerCase().endsWith(".neon.tech") &&
      hostParts.length >= 3 &&
      hostParts[0]?.endsWith("-pooler")
    ) {
      hostParts[0] = hostParts[0].slice(0, -"-pooler".length);
      parsed.hostname = hostParts.join(".");
      return parsed.toString();
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
}

function resolvePostgresDatasourceUrl(): string {
  for (const key of [
    "DIRECT_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
  ] as const) {
    const candidate = process.env[key]?.trim();
    if (isPostgresUrl(candidate)) {
      return candidate;
    }
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (isPostgresUrl(databaseUrl)) {
    return deriveDirectNeonUrl(databaseUrl);
  }

  return "postgresql://opencontext:opencontext@localhost:5432/opencontext?schema=public";
}

export default defineConfig({
  schema: "prisma/postgres/schema.prisma",
  migrations: {
    path: "prisma/postgres/migrations",
  },
  datasource: {
    url: resolvePostgresDatasourceUrl(),
  },
});
