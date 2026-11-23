import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./callback-url";

describe("sign-in callback URL", () => {
  it("keeps ordinary same-origin paths and query strings", () => {
    expect(safeCallbackUrl("/app/jobs?filter=failed")).toBe("/app/jobs?filter=failed");
  });

  it("rejects browser-ambiguous open redirects", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "\n//evil.example",
    ]) {
      expect(safeCallbackUrl(value)).toBe("/app/jobs");
    }
  });

  it("uses an existing destination when no callback is supplied", () => {
    expect(safeCallbackUrl(undefined)).toBe("/app/jobs");
  });
});
