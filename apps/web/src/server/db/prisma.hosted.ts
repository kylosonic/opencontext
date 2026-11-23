import { PrismaClient } from "@prisma/client";
import { postgresAdapter } from "./postgres-adapter";

export type { Job, Media, User } from "@prisma/client";

/** PostgreSQL-only client used by the portable hosted image. */
function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) {
    throw new Error("DATABASE_URL must use PostgreSQL in the hosted web image.");
  }
  return new PrismaClient({ adapter: postgresAdapter(url) });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function getPrismaClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
