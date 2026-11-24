import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class RemoteImportError extends Error {
  constructor(
    readonly code:
      | "INVALID_URL"
      | "UNSAFE_URL"
      | "FORBIDDEN"
      | "FETCH_FAILED"
      | "TOO_LARGE"
      | "UNSUPPORTED"
      | "VALIDATION_ERROR",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups. Handles the `::`
 * compression and a trailing dotted-quad form. Returns null when the input
 * is not a syntactically valid IPv6 address.
 */
function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase();
  // Strip a zone id such as `%eth0`; it is not part of the address.
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  let tail: number[] = [];
  let v4Part = false;
  const lastColon = value.lastIndexOf(":");
  const possibleV4 = value.slice(lastColon + 1);
  if (isIP(possibleV4) === 4) {
    const octets = possibleV4.split(".").map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    // Drop the `:a.b.c.d` suffix; the dotted quad supplies the final groups.
    value = value.slice(0, lastColon);
    v4Part = true;
  }

  const compressed = value.includes("::");
  const [headRaw = "", restRaw = ""] = value.split("::");
  const parts = (segment: string) =>
    segment ? segment.split(":").filter(Boolean) : [];
  const head = parts(headRaw).map((group) => parseInt(group, 16));
  const mid = parts(restRaw).map((group) => parseInt(group, 16));
  const typed = [...head, ...mid];
  if (typed.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }

  let groups: number[];
  if (compressed) {
    const zeros = 8 - typed.length - tail.length;
    if (zeros < 1) return null;
    groups = [...head, ...new Array<number>(zeros).fill(0), ...mid, ...tail];
  } else if (v4Part && typed.length === 0) {
    // `::a.b.c.d` collapses to the bare compression marker; the quad fills
    // the low 32 bits with the remaining groups zero.
    groups = [...new Array<number>(6).fill(0), ...tail];
  } else {
    groups = [...typed, ...tail];
  }
  return groups.length === 8 ? groups : null;
}

/** True for loopback, link-local, private, CGNAT, multicast, and reserved ranges. */
export function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets as [number, number, number, number];
    return (
      a === 0 || // "this network"
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local (cloud metadata)
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 192 && b === 0 && c === 0) || // reserved / IETF
      (a === 192 && b === 0 && c === 2) || // TEST-NET-1
      (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) || // TEST-NET-2
      (a === 203 && b === 0 && c === 113) || // TEST-NET-3
      a >= 224 // multicast, reserved, broadcast
    );
  }

  const groups = ipv6Groups(address);
  if (!groups) return true; // unparseable literals are refused, never fetched
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) forms must be
  // judged by the embedded IPv4 address, or they bypass every IPv4 rule.
  const zeroPrefix =
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    (g5 === 0xffff || g5 === 0);
  if (zeroPrefix && (g6 !== 0 || g7 !== 0)) {
    const v4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
    return isPrivateIp(v4);
  }
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return true; // ::1

  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (g0 & 0xff00) === 0xff00 || // multicast ff00::/8
    (g0 === 0x2001 && g1 === 0x0db8) || // documentation range
    (g0 === 0x2001 && g1 === 0x0000) || // Teredo tunneling 2001::/32
    g0 === 0x2002 || // 6to4 tunneling 2002::/16
    (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) || // discard-only 100::/64
    (g0 === 0x0064 &&
      g1 === 0xff9b &&
      g2 === 0 &&
      g3 === 0 &&
      g4 === 0 &&
      g5 === 0) || // NAT64 64:ff9b::/96
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001) // NAT64 local-use 64:ff9b:1::/48
  );
}

/** Resolve a URL's hostname and verify all addresses point to public networks. */
export async function resolvePublicHost(
  url: URL,
): Promise<{ address: string; family: 4 | 6 }> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImportError("INVALID_URL", "Only HTTP and HTTPS URLs are supported");
  }
  if (
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  ) {
    throw new RemoteImportError(
      "UNSAFE_URL",
      "URLs with credentials or custom ports are not allowed",
    );
  }
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new RemoteImportError("UNSAFE_URL", "Local network URLs are not allowed");
  }
  const literalFamily = isIP(hostname);
  if (literalFamily && isPrivateIp(hostname)) {
    throw new RemoteImportError("UNSAFE_URL", "Private network URLs are not allowed");
  }
  const addresses: Array<{ address: string; family: 4 | 6 }> = literalFamily
    ? [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }]
    : (await lookup(hostname, { all: true, verbatim: true }).catch(() => [])).map(
        (item) => ({ address: item.address, family: item.family === 6 ? 6 : 4 }),
      );
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) {
    throw new RemoteImportError("UNSAFE_URL", "The URL does not resolve to a public address");
  }
  // Prefer IPv4 when both families resolve. A host may publish AAAA records
  // while the worker/network has no working IPv6 route.
  return addresses.sort((left, right) => left.family - right.family)[0];
}
