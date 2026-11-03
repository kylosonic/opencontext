import { PrismaClient } from "@prisma/client";

/**
 * Single PrismaClient per process (Next.js dev hot-reload safe).
 * DATABASE_URL selects the engine (ADR-0003): SQLite file locally,
 * PostgreSQL in production.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { Job, Media, User } from "@prisma/client";
