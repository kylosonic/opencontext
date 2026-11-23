import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authSecret,
  deploymentEnvironment,
  devAuthEnabled,
  storageProvider,
} from "../index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deployment environment", () => {
  it("identifies the Compose stack as local development", () => {
    expect(
      deploymentEnvironment({ NODE_ENV: "production", OPENCONTEXT_ENV: "local" }),
    ).toBe("development");
  });

  it("keeps unmarked production images strict", () => {
    expect(deploymentEnvironment({ NODE_ENV: "production" })).toBe("production");
  });

  it("does not let the local override mask Vercel production", () => {
    expect(
      deploymentEnvironment({
        NODE_ENV: "production",
        OPENCONTEXT_ENV: "local",
        VERCEL_ENV: "production",
      }),
    ).toBe("production");
  });
});

describe("storage selection", () => {
  it("fails closed instead of silently choosing local storage", () => {
    expect(() => storageProvider({ STORAGE_PROVIDER: "typo" })).toThrow(
      /STORAGE_PROVIDER/,
    );
    expect(storageProvider({ STORAGE_PROVIDER: " S3 " })).toBe("s3");
  });
});

describe("authentication safety", () => {
  it("allows the development fallback only for an explicit local environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENCONTEXT_ENV", "local");
    vi.stubEnv("AUTH_SECRET", "");

    expect(authSecret()).toBe("opencontext-dev-auth-secret-do-not-use-in-production");
  });

  it("fails closed for a production deployment without a strong secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENCONTEXT_ENV", "");
    vi.stubEnv("AUTH_SECRET", "");

    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
  });

  it("allows route collection with a build-only secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENCONTEXT_ENV", "");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    expect(authSecret()).toBe("opencontext-build-only-auth-secret-not-for-runtime");
  });

  it("rejects placeholder and short production secrets", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENCONTEXT_ENV", "");

    vi.stubEnv("AUTH_SECRET", "change-me");
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
    vi.stubEnv("AUTH_SECRET", "short");
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
  });

  it("never enables passwordless development auth outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENCONTEXT_ENV", "");
    vi.stubEnv("DEV_AUTH_ENABLED", "true");

    expect(devAuthEnabled()).toBe(false);
  });
});
