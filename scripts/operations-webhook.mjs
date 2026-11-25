import { createHmac } from "node:crypto";

/**
 * Validate an outbound operations webhook destination URL before sending.
 * Only HTTP(S) destinations without embedded credentials are accepted.
 */
export function validateWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Alert webhook URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Alert webhook URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Alert webhook URL must not embed credentials");
  }
  return parsed;
}

/**
 * Sign `{timestampSec}.{body}` using HMAC-SHA256 (`sha256=<hex>`).
 */
export function signWebhookPayload(body, secret, timestampSec) {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSec}.${body}`, "utf8")
    .digest("hex");
  return `sha256=${digest}`;
}

/**
 * Build the validated target URL, request headers, and JSON body for an
 * operations alert notification.
 */
export function buildAlertWebhookRequest({
  url,
  payload,
  secret,
  nowSec = Math.floor(Date.now() / 1000),
}) {
  const validated = validateWebhookUrl(url);
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
  };
  const trimmedSecret = secret?.trim();
  if (trimmedSecret) {
    headers["X-OpenContext-Timestamp"] = String(nowSec);
    headers["X-OpenContext-Signature"] = signWebhookPayload(
      body,
      trimmedSecret,
      nowSec,
    );
  }
  return { url: validated.href, headers, body };
}
