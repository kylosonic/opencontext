import { PrismaPg } from "@prisma/adapter-pg";

/** Preserve Prisma's `?schema=` contract when using the PostgreSQL driver adapter. */
export function postgresAdapter(connectionString: string): PrismaPg {
  const url = new URL(connectionString);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  return new PrismaPg(url.toString(), schema ? { schema } : undefined);
}
