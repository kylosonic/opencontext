import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/ready/route";
import { deploymentEnvironment, evaluateReadiness } from "@/server/readiness";

const SECRET_VALUES = {
  AUTH_SECRET: "a-production-secret-that-must-not-leak",
  AUTH_GITHUB_ID: "github-client-id",
  AUTH_GITHUB_SECRET: "github-client-secret-that-must-not-leak",
  STORAGE_S3_ACCESS_KEY_ID: "storage-access-key-that-must-not-leak",
  STORAGE_S3_SECRET_ACCESS_KEY: "storage-secret-that-must-not-leak",
  WORKER_API_TOKEN: "worker-token-that-must-not-leak",
};

function productionEnv() {
  return {
    ...SECRET_VALUES,
    DATABASE_URL: "postgresql://user:password@db.example/opencontext",
    STORAGE_PROVIDER: "s3",
    STORAGE_S3_ENDPOINT: "https://storage.example",
    STORAGE_S3_REGION: "us-east-1",
    STORAGE_S3_BUCKET: "opencontext",
    APP_BASE_URL: "https://opencontext.example",
    RATE_LIMIT_BACKEND: "database",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production readiness", () => {
  it("passes when every required integration is configured", () => {
    const report = evaluateReadiness(productionEnv(), "production");

    expect(report.ready).toBe(true);
    expect(report.environment).toBe("production");
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it("reports every blocker without exposing secret values", () => {
    const report = evaluateReadiness(
      { AUTH_SECRET: SECRET_VALUES.AUTH_SECRET },
      "production",
    );
    const serialized = JSON.stringify(report);

    expect(report.ready).toBe(false);
    expect(report.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual([
      "database",
      "auth",
      "storage",
      "worker",
      "publicUrl",
      "rateLimit",
    ]);
    for (const value of Object.values(SECRET_VALUES)) {
      expect(serialized).not.toContain(value);
    }
  });

  it("allows local development defaults", () => {
    const report = evaluateReadiness(
      {
        AUTH_SECRET: "local-secret",
        DEV_AUTH_ENABLED: "true",
        WORKER_API_TOKEN: "local-worker-token",
      },
      "development",
    );

    expect(report.ready).toBe(true);
  });
});

describe("readiness route", () => {
  it("returns 503 and no-store when production configuration is incomplete", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("STORAGE_PROVIDER", "");
    vi.stubEnv("WORKER_API_TOKEN", "");
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("RATE_LIMIT_BACKEND", "");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.ready).toBe(false);
    expect(body.checks).toHaveLength(6);
  });

  it("distinguishes Vercel preview from production", () => {
    expect(
      deploymentEnvironment({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
      }),
    ).toBe("preview");
    expect(
      deploymentEnvironment({
        VERCEL: "1",
        VERCEL_ENV: "production",
        NODE_ENV: "production",
      }),
    ).toBe("production");
    expect(
      deploymentEnvironment({ VERCEL: "1", NODE_ENV: "production" }),
    ).toBe("preview");
    expect(deploymentEnvironment({ NODE_ENV: "test" })).toBe("development");
  });
});
