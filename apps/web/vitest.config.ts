import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Serial execution: all files share one SQLite test database.
    fileParallelism: false,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/server/__tests__/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      "@opencontext/schemas": path.resolve(
        dirname,
        "../../packages/schemas/src/index.ts",
      ),
    },
  },
});
