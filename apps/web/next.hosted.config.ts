import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const hostedDbClient = path.join(appRoot, "src/server/db/prisma.hosted.ts");

const nextConfig = {
  agentRules: false,
  output: "standalone" as const,
  typescript: {
    tsconfigPath: "tsconfig.hosted.json",
  },
  transpilePackages: ["@kylosonic/opencontext-schemas", "@opencontext/config"],
  webpack(config: { resolve: { alias: Record<string, string | false> } }) {
    config.resolve.alias["@kylosonic/opencontext-schemas"] = path.resolve(
      appRoot,
      "../../packages/schemas/dist/index.js",
    );
    config.resolve.alias["@/server/db/prisma"] = hostedDbClient;
    config.resolve.alias["@prisma/adapter-better-sqlite3"] = false;
    return config;
  },
};

export default nextConfig;
