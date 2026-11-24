import { PrismaPg } from "@prisma/adapter-pg";

function positiveInteger(name: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/** Preserve Prisma's `?schema=` contract when using the PostgreSQL driver adapter. */
export function postgresAdapter(connectionString: string): PrismaPg {
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  const serverless = process.env.VERCEL === "1";
  return new PrismaPg(
    {
      connectionString: url.toString(),
      max: positiveInteger("DB_POOL_MAX", serverless ? 3 : 10, 100),
      idleTimeoutMillis: positiveInteger("DB_POOL_IDLE_TIMEOUT_MS", 10_000, 300_000),
      connectionTimeoutMillis: positiveInteger(
        "DB_POOL_CONNECTION_TIMEOUT_MS",
        5_000,
        60_000,
      ),
      application_name: "opencontext-web",
    },
    schema ? { schema } : undefined,
  );
}
