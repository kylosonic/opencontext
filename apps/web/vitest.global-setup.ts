import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One-time global setup: apply migrations to a dedicated test
 * SQLite database (apps/web/prisma/test.db — gitignored via *.db).
 * Runs once per `vitest run`, before any test file imports the client.
 */
export default function globalSetup() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const databasePath = path.join(dirname, "prisma", "test.db");
  rmSync(databasePath, { force: true });
  writeFileSync(databasePath, new Uint8Array());
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
  try {
    execSync("npx prisma migrate deploy --config prisma.config.ts", {
      cwd: dirname,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
      encoding: "utf8",
      windowsHide: true,
    });
  } catch (error) {
    const output =
      (error as { stdout?: string; stderr?: string }).stdout ??
      (error as { stderr?: string }).stderr ??
      String(error);
    throw new Error(`prisma migrate deploy failed: ${output}`);
  }
}
