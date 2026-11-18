import { describe, expect, it } from "vitest";
import { deploymentEnvironment } from "../index";

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
