/**
 * Per-test-file setup. Runs before every test file in its own worker
 * process, so these env values are in place before any module that
 * reads them (Prisma client, storage factory, auth config) is imported.
 */
process.env.DATABASE_URL = "file:./test.db";
process.env.WORKER_API_TOKEN = "test-worker-token";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_PATH = ".test-storage";
process.env.AUTH_SECRET = "test-auth-secret";
process.env.AUTH_GITHUB_ID = "";
process.env.AUTH_GITHUB_SECRET = "";
