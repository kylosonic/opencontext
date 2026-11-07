import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@opencontext/schemas", "@opencontext/config"],
  webpack(config) {
    config.resolve.alias["@opencontext/schemas"] = path.resolve(
      process.cwd(),
      "../../packages/schemas/dist/index.js",
    );
    return config;
  },
};

export default nextConfig;
