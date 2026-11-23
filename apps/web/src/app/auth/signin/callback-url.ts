const DEFAULT_CALLBACK_URL = "/app/jobs";
const PLACEHOLDER_ORIGIN = "https://opencontext.invalid";

/** Keep only a parsed, same-origin absolute path for post-sign-in redirects. */
export function safeCallbackUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_CALLBACK_URL;
  }
  try {
    const parsed = new URL(value, PLACEHOLDER_ORIGIN);
    if (parsed.origin !== PLACEHOLDER_ORIGIN) {
      return DEFAULT_CALLBACK_URL;
    }
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return path.startsWith("/") && !path.startsWith("//") ? path : DEFAULT_CALLBACK_URL;
  } catch {
    return DEFAULT_CALLBACK_URL;
  }
}

export { DEFAULT_CALLBACK_URL };
