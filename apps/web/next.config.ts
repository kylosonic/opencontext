import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  output: "standalone",
  transpilePackages: ["@kylosonic/opencontext-schemas", "@opencontext/config"],
  webpack(config) {
    config.resolve.alias["@kylosonic/opencontext-schemas"] = path.resolve(
      process.cwd(),
      "../../packages/schemas/dist/index.js",
    );
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
