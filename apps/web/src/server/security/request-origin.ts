/** Browser mutations must be same-origin; non-browser JSON clients are allowed. */
export function safeMutation(
  method: string,
  headers: Headers,
  requestHost: string,
): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    return true;
  }
  const fetchSite = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const origin = headers.get("origin");
  const referer = headers.get("referer");
  const trustedProxy =
    process.env.VERCEL === "1" ||
    /^(?:1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() ?? "");
  const forwardedHost = trustedProxy
    ? headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim()
    : undefined;
  const expectedHost = forwardedHost || requestHost;
  const candidate = origin || referer;
  try {
    if (candidate) {
      return (
        new URL(candidate).host.toLowerCase() === expectedHost.toLowerCase()
      );
    }
  } catch {
    return false;
  }

  if (fetchSite === "same-origin") return true;
  const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim();
  // JSON cannot be a cross-site simple request: browsers must preflight it.
  return (
    contentType === "application/json" ||
    (contentType?.startsWith("application/") === true &&
      contentType.endsWith("+json"))
  );
}
