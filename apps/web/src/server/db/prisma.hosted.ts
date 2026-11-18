import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export type { Job, Media, User } from "@prisma/client";

/** PostgreSQL-only client used by the portable hosted image. */
function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) {
    throw new Error("DATABASE_URL must use PostgreSQL in the hosted web image.");
  }
  return new PrismaClient({ adapter: new PrismaPg(url) });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
