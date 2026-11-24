import { describe, expect, it } from "vitest";
import {
  isPrivateIp,
  RemoteImportError,
  resolvePublicHost,
  safeFilename,
} from "@/server/imports/remote";

describe("remote filename handling", () => {
  it("does not fail on malformed percent escapes", () => {
    const name = safeFilename(
      new URL("https://example.com/media/clip%E0%A4%A.mp4"),
      "video/mp4",
      "",
    );
    expect(name).toContain("clip");
    expect(name.endsWith(".mp4")).toBe(true);
  });
});

describe("isPrivateIp (SSRF guard)", () => {
  it("blocks IPv4 loopback, private, link-local, CGNAT, and reserved space", () => {
    for (const address of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "127.0.0.1",
      "127.1.2.3",
      "169.254.169.254", // cloud instance metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
      "192.0.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it("allows ordinary public IPv4 addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "104.21.0.1", "172.32.0.1", "100.63.255.255"]) {
      expect(isPrivateIp(address), address).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local, multicast, transition, and discard ranges", () => {
    for (const address of [
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "febf::1",
      "ff02::1",
      "64:ff9b::127.0.0.1",
      "64:ff9b:1::1",
      "2002:7f00:0001::1",
      "2001:0::1",
      "fec0::1",
      "100::1",
    ]) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it("blocks IPv4 TEST-NET documentation and 6to4 relay ranges", () => {
    for (const address of ["192.0.2.1", "198.51.100.1", "203.0.113.1", "192.88.99.1"]) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it("blocks IPv4-mapped IPv6 that hides private IPv4 addresses", () => {
    // These previously bypassed the string-prefix check entirely.
    for (const address of [
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "::ffff:192.168.1.1",
      "::ffff:172.16.0.1",
      "::ffff:169.254.169.254",
      "::ffff:100.64.0.1",
      "::127.0.0.1", // IPv4-compatible form
      "0:0:0:0:0:ffff:127.0.0.1",
    ]) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it("allows public IPv4-mapped IPv6", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:1.1.1.1")).toBe(false);
  });

  it("allows ordinary public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("fails closed on unparseable addresses", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("1:2:3:4:5:6:7:8:9")).toBe(true);
  });
});

describe("resolvePublicHost", () => {
  const reject = async (raw: string, code: string) => {
    await expect(resolvePublicHost(new URL(raw))).rejects.toBeInstanceOf(RemoteImportError);
    await expect(resolvePublicHost(new URL(raw))).rejects.toMatchObject({ code });
  };

  it("rejects non-HTTP schemes", async () => {
    await reject("file:///etc/passwd", "INVALID_URL");
    await reject("ftp://example.com/a.mp4", "INVALID_URL");
    await reject("gopher://example.com/", "INVALID_URL");
  });

  it("rejects embedded credentials", async () => {
    await reject("https://user:pass@example.com/a.mp4", "UNSAFE_URL");
  });

  it("rejects non-standard ports", async () => {
    await reject("http://example.com:8080/a.mp4", "UNSAFE_URL");
    await reject("http://example.com:22/a.mp4", "UNSAFE_URL");
  });

  it("allows the default HTTP and HTTPS ports", async () => {
    // Port must be permitted; failure here may only be resolution, not UNSAFE_URL.
    for (const raw of ["http://127.0.0.1:80/a", "https://127.0.0.1:443/a"]) {
      await expect(resolvePublicHost(new URL(raw))).rejects.toMatchObject({
        code: "UNSAFE_URL",
      });
    }
  });

  it("rejects localhost and localhost subdomains without DNS", async () => {
    await reject("http://localhost/a.mp4", "UNSAFE_URL");
    await reject("http://localhost./a.mp4", "UNSAFE_URL");
    await reject("http://app.localhost/a.mp4", "UNSAFE_URL");
  });

  it("rejects private IP literals before any network access", async () => {
    await reject("http://127.0.0.1/a.mp4", "UNSAFE_URL");
    await reject("http://169.254.169.254/latest/meta-data/", "UNSAFE_URL");
    await reject("http://10.0.0.1/a.mp4", "UNSAFE_URL");
    await reject("http://[::1]/a.mp4", "UNSAFE_URL");
    await reject("http://[::ffff:127.0.0.1]/a.mp4", "UNSAFE_URL");
    await reject("http://[fd00::1]/a.mp4", "UNSAFE_URL");
  });
});
