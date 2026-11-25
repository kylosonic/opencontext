import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildAlertWebhookRequest,
  signWebhookPayload,
  validateWebhookUrl,
} from "./operations-webhook.mjs";

test("validateWebhookUrl accepts https/http and rejects embedded credentials or bad schemes", () => {
  assert.equal(
    validateWebhookUrl("https://hooks.example.com/ops").href,
    "https://hooks.example.com/ops",
  );
  assert.throws(() => validateWebhookUrl("not-a-url"), /invalid/);
  assert.throws(() => validateWebhookUrl("ftp://hooks.example.com/ops"), /http or https/);
  assert.throws(
    () => validateWebhookUrl("https://user:pass@hooks.example.com/ops"),
    /credentials/,
  );
});

test("buildAlertWebhookRequest signs body with HMAC-SHA256 when secret is configured", () => {
  const payload = { event: "opencontext.operations", healthy: false };
  const built = buildAlertWebhookRequest({
    url: "https://hooks.example.com/ops",
    payload,
    secret: "super-secret-signing-key",
    nowSec: 1700000000,
  });

  const expectedHex = createHmac("sha256", "super-secret-signing-key")
    .update(`1700000000.${built.body}`, "utf8")
    .digest("hex");

  assert.equal(built.headers["Content-Type"], "application/json");
  assert.equal(built.headers["X-OpenContext-Timestamp"], "1700000000");
  assert.equal(built.headers["X-OpenContext-Signature"], `sha256=${expectedHex}`);
  assert.equal(
    signWebhookPayload(built.body, "super-secret-signing-key", 1700000000),
    `sha256=${expectedHex}`,
  );
});

test("buildAlertWebhookRequest omits signature headers when secret is unset", () => {
  const built = buildAlertWebhookRequest({
    url: "https://hooks.example.com/ops",
    payload: { healthy: true },
  });
  assert.equal(built.headers["X-OpenContext-Timestamp"], undefined);
  assert.equal(built.headers["X-OpenContext-Signature"], undefined);
});
