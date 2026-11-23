import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeMutation } from "@/server/security/request-origin";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy mutation origin checks", () => {
  it("rejects cross-site fetch metadata and same-site host ambiguity", () => {
    expect(
      safeMutation("POST", new Headers({ "sec-fetch-site": "cross-site" }), "app.test"),
    ).toBe(false);
    expect(
      safeMutation("POST", new Headers({ "sec-fetch-site": "same-site" }), "app.test"),
    ).toBe(false);
  });

  it("requires a same-origin proof when Origin and Referer are absent", () => {
    expect(safeMutation("POST", new Headers(), "app.test")).toBe(false);
    expect(
      safeMutation("POST", new Headers({ "content-type": "video/mp4" }), "app.test"),
    ).toBe(false);
    expect(
      safeMutation(
        "POST",
        new Headers({ "content-type": "application/json; charset=utf-8" }),
        "app.test",
      ),
    ).toBe(true);
    expect(
      safeMutation(
        "POST",
        new Headers({ "sec-fetch-site": "same-origin" }),
        "app.test",
      ),
    ).toBe(true);
  });

  it("compares Origin and Referer to the trusted request host", () => {
    expect(
      safeMutation(
        "POST",
        new Headers({
          origin: "https://evil.test",
          "x-forwarded-host": "evil.test",
        }),
        "app.test",
      ),
    ).toBe(false);
    expect(
      safeMutation(
        "POST",
        new Headers({ referer: "https://app.test/app/jobs" }),
        "app.test",
      ),
    ).toBe(true);
  });

  it("accepts X-Forwarded-Host only when proxy trust is explicit", () => {
    vi.stubEnv("VERCEL", "1");
    expect(
      safeMutation(
        "POST",
        new Headers({
          origin: "https://public.test",
          "x-forwarded-host": "public.test",
        }),
        "internal:3000",
      ),
    ).toBe(true);

    vi.stubEnv("VERCEL", "0");
    expect(
      safeMutation(
        "POST",
        new Headers({
          origin: "https://public.test",
          "x-forwarded-host": "public.test",
        }),
        "internal:3000",
      ),
    ).toBe(false);
  });
});
