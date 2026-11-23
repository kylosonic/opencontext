import { describe, expect, it } from "vitest";
import { resolveAuthTrustHost } from "@/auth.config";

describe("Auth.js trustHost defaults", () => {
  it("preserves the Auth.js fallback when no override is set", () => {
    expect(resolveAuthTrustHost({})).toBeUndefined();
    expect(resolveAuthTrustHost({ AUTH_TRUST_HOST: " " })).toBeUndefined();
  });

  it("honors explicit true/false values", () => {
    expect(resolveAuthTrustHost({ AUTH_TRUST_HOST: "true" })).toBe(true);
    expect(resolveAuthTrustHost({ AUTH_TRUST_HOST: "FALSE" })).toBe(false);
  });

  it("always trusts Vercel's platform host validation", () => {
    expect(
      resolveAuthTrustHost({ VERCEL: "1", AUTH_TRUST_HOST: "false" }),
    ).toBe(true);
  });
});
