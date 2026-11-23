import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { deploymentEnvironment } from "@opencontext/config";
import { postgresAdapter } from "./postgres-adapter";

/**
 * Single PrismaClient per process (Next.js dev hot-reload safe).
 * DATABASE_URL selects the engine (ADR-0003): SQLite file locally,
 * PostgreSQL in production.
 */
function createPrismaClient(): PrismaClient {
  const configured = process.env.DATABASE_URL?.trim();
  const url =
    configured ||
    (deploymentEnvironment() === "development" ? "file:./prisma/dev.db" : "");
  if (!url) {
    throw new Error("DATABASE_URL is required outside local development");
  }
  const isPostgres = /^postgres(?:ql)?:\/\//i.test(url);
  if (!isPostgres && !url.startsWith("file:")) {
    throw new Error("DATABASE_URL must use PostgreSQL or a SQLite file URL");
  }
  const adapter = isPostgres
    ? postgresAdapter(url)
    : new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function getPrismaClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

// Next.js evaluates route modules while collecting build configuration. Resolve
// the database only when code actually queries it so credential-free builds do
// not weaken the runtime requirement or open a connection during compilation.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type { Job, Media, User } from "@prisma/client";
