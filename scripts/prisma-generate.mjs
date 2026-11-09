import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "apps", "web");
const prismaEntry = [
  path.join(webDir, "node_modules", "prisma", "build", "index.js"),
  path.join(repoRoot, "node_modules", "prisma", "build", "index.js"),
].find((candidate) => existsSync(candidate));

if (!prismaEntry) {
  console.error("Could not locate the Prisma CLI. Run npm install first.");
  process.exit(1);
}

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: webDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// The generated client embeds the datasource provider, so it must match the
// runtime DATABASE_URL. SQLite stays the development default.
if ((process.env.DATABASE_URL ?? "").startsWith("postgres")) {
  run([path.join(repoRoot, "scripts", "prisma-schema.mjs"), "postgresql"]);
  run([prismaEntry, "generate", "--config", "prisma.postgres.config.ts"]);
} else {
  run([prismaEntry, "generate"]);
}
