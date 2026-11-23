import type { NextConfig } from "next";
import path from "node:path";

function storageOrigin(): string {
  const raw = process.env.STORAGE_S3_ENDPOINT?.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? ` ${parsed.origin}` : "";
  } catch {
    return "";
  }
}

const objectOrigin = storageOrigin();
const contentSecurityPolicy =
  `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:${objectOrigin}; media-src 'self' blob: https:${objectOrigin}; font-src 'self' data:; connect-src 'self' https:${objectOrigin}; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://github.com; frame-ancestors 'self'`;

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  // The authenticated PDF preview is intentionally framed by this same
  // origin; cross-origin embedding remains blocked.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
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
