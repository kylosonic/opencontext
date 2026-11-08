import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per-test-file setup. Runs before every test file in its own worker
 * process, so these env values are in place before any module that
 * reads them (Prisma client, storage factory, auth config) is imported.
 */
const dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.join(dirname, "prisma", "test.db");
process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
process.env.WORKER_API_TOKEN = "test-worker-token";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_PATH = ".test-storage";
process.env.AUTH_SECRET = "test-auth-secret";
process.env.AUTH_GITHUB_ID = "";
process.env.AUTH_GITHUB_SECRET = "";
