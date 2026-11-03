import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One-time global setup: push the Prisma schema into a dedicated test
 * SQLite database (apps/web/prisma/test.db — gitignored via *.db).
 * Runs once per `vitest run`, before any test file imports the client.
 */
export default function globalSetup() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      cwd: dirname,
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      stdio: "pipe",
      encoding: "utf8",
      windowsHide: true,
    });
  } catch (error) {
    const output =
      (error as { stdout?: string; stderr?: string }).stdout ??
      (error as { stderr?: string }).stderr ??
      String(error);
    throw new Error(`prisma db push failed: ${output}`);
  }
}
