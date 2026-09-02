import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@opencontext/schemas", "@opencontext/config"],
};

export default nextConfig;
