import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSmokeConfig, runSmokeChecks } from "./post-deploy-smoke.mjs";

async function startTestServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendJson(res, status, contentType, body) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

test("resolveSmokeConfig requires valid http(s) URL without credentials", () => {
  assert.throws(() => resolveSmokeConfig({}), /OPENCONTEXT_BASE_URL is required/);
  assert.throws(
    () => resolveSmokeConfig({ OPENCONTEXT_BASE_URL: "ftp://example.com" }),
    /http or https/,
  );
  assert.throws(
    () => resolveSmokeConfig({ OPENCONTEXT_BASE_URL: "https://user:pass@example.com" }),
    /credentials/,
  );

  const cfg = resolveSmokeConfig({
    OPENCONTEXT_BASE_URL: "https://opencontext.example.com/some/path/",
    OPS_API_TOKEN: "  ops-token  ",
    SMOKE_RETRIES: "2",
    SMOKE_RETRY_DELAY_MS: "25",
  });
  assert.equal(cfg.baseUrl, "https://opencontext.example.com");
  assert.equal(cfg.opsApiToken, "ops-token");
  assert.equal(cfg.retries, 2);
  assert.equal(cfg.retryDelayMs, 25);
});

test("runSmokeChecks passes all checks with and without OPS_API_TOKEN (including SCIM application/scim+json)", async () => {
  const authHeaders = [];
  const server = await startTestServer((req, res) => {
    if (req.url === "/api/health/ready") {
      authHeaders.push(req.headers.authorization ?? null);
      if (req.headers.authorization === "Bearer test-ops-token") {
        return sendJson(res, 200, "application/json", {
          ready: true,
          checkedAt: "2026-11-25T10:00:00.000Z",
          blockers: [],
        });
      }
      return sendJson(res, 200, "application/json", {
        ready: true,
        checkedAt: "2026-11-25T10:00:00.000Z",
      });
    }
    if (req.url === "/api/scim/v2/ServiceProviderConfig") {
      return sendJson(res, 200, "application/scim+json", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      });
    }
    if (req.url === "/api/auth/providers") {
      return sendJson(res, 200, "application/json", {
        github: { id: "github", name: "GitHub" },
      });
    }
    if (req.url === "/auth/signin" || req.url === "/") {
      return sendHtml(res, 200, "<!DOCTYPE html><html><body>OpenContext</body></html>");
    }
    res.writeHead(404);
    res.end("not found");
  });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oc-smoke-pass-"));
  const summaryPath = path.join(tmpDir, "summary.json");
  const stepSummaryPath = path.join(tmpDir, "step-summary.md");

  try {
    const publicOnly = await runSmokeChecks({
      env: {
        OPENCONTEXT_BASE_URL: server.baseUrl,
        SMOKE_RETRIES: "1",
        SMOKE_RETRY_DELAY_MS: "5",
      },
      summaryPath,
    });
    assert.equal(publicOnly.passed, true);
    assert.equal(publicOnly.failedCount, 0);
    assert.equal(publicOnly.checks.length, 5);
    assert.deepEqual(authHeaders, [null]);

    const withOpsToken = await runSmokeChecks({
      env: {
        OPENCONTEXT_BASE_URL: server.baseUrl,
        OPS_API_TOKEN: "test-ops-token",
        SMOKE_RETRIES: "1",
        SMOKE_RETRY_DELAY_MS: "5",
        GITHUB_STEP_SUMMARY: stepSummaryPath,
      },
      summaryPath,
    });
    assert.equal(withOpsToken.passed, true);
    assert.equal(withOpsToken.failedCount, 0);
    assert.equal(withOpsToken.checks.length, 6);
    assert.deepEqual(authHeaders, [null, null, "Bearer test-ops-token"]);

    const writtenSummary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(writtenSummary.passed, true);
    assert.equal(writtenSummary.checks.length, 6);

    const stepSummary = await readFile(stepSummaryPath, "utf8");
    assert.match(stepSummary, /Post-deploy smoke verification/);
    assert.match(stepSummary, /6\/6 passed/);
  } finally {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("runSmokeChecks retries transient 503 responses and passes when endpoint recovers", async () => {
  let healthCalls = 0;
  const server = await startTestServer((req, res) => {
    if (req.url === "/api/health/ready") {
      healthCalls += 1;
      if (healthCalls === 1) {
        return sendJson(res, 503, "application/json", {
          ready: false,
          checkedAt: "2026-11-25T10:00:00.000Z",
        });
      }
      return sendJson(res, 200, "application/json", {
        ready: true,
        checkedAt: "2026-11-25T10:00:01.000Z",
      });
    }
    if (req.url === "/api/scim/v2/ServiceProviderConfig") {
      return sendJson(res, 200, "application/scim+json", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      });
    }
    if (req.url === "/api/auth/providers") {
      return sendJson(res, 200, "application/json", { github: { id: "github" } });
    }
    if (req.url === "/auth/signin" || req.url === "/") {
      return sendHtml(res, 200, "<html><body>ok</body></html>");
    }
    res.writeHead(404);
    res.end();
  });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oc-smoke-retry-"));
  try {
    const report = await runSmokeChecks({
      env: {
        OPENCONTEXT_BASE_URL: server.baseUrl,
        SMOKE_RETRIES: "2",
        SMOKE_RETRY_DELAY_MS: "5",
      },
      summaryPath: path.join(tmpDir, "summary.json"),
    });
    assert.equal(report.passed, true);
    assert.equal(report.checks[0].attempts, 2);
    assert.equal(healthCalls, 2);
  } finally {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("runSmokeChecks fails when readiness stays false and delivers signed alert webhook", async () => {
  const receivedWebhooks = [];
  const server = await startTestServer(async (req, res) => {
    if (req.url === "/webhook" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      receivedWebhooks.push({
        headers: req.headers,
        rawBody,
        payload: JSON.parse(rawBody),
      });
      res.writeHead(202, { "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (req.url === "/api/health/ready") {
      return sendJson(res, 503, "application/json", {
        ready: false,
        checkedAt: "2026-11-25T10:00:00.000Z",
      });
    }
    if (req.url === "/api/scim/v2/ServiceProviderConfig") {
      return sendJson(res, 200, "application/scim+json", {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      });
    }
    if (req.url === "/api/auth/providers") {
      return sendJson(res, 200, "application/json", { github: { id: "github" } });
    }
    if (req.url === "/auth/signin" || req.url === "/") {
      return sendHtml(res, 200, "<html><body>ok</body></html>");
    }
    res.writeHead(404);
    res.end();
  });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oc-smoke-fail-"));
  const webhookSecret = "smoke-webhook-secret-123";
  try {
    const report = await runSmokeChecks({
      env: {
        OPENCONTEXT_BASE_URL: server.baseUrl,
        OPS_API_TOKEN: "secret-should-not-leak",
        ALERT_WEBHOOK_URL: `${server.baseUrl}/webhook`,
        ALERT_WEBHOOK_SECRET: webhookSecret,
        SMOKE_RETRIES: "1",
        SMOKE_RETRY_DELAY_MS: "5",
      },
      summaryPath: path.join(tmpDir, "summary.json"),
    });

    assert.equal(report.passed, false);
    assert.equal(report.failedCount, 2);
    assert.equal(report.webhookSent, true);
    assert.equal(report.webhookError, null);

    assert.equal(receivedWebhooks.length, 1);
    const webhook = receivedWebhooks[0];
    assert.equal(webhook.payload.event, "opencontext.deploy_smoke_failed");
    assert.equal(webhook.payload.baseUrl, server.baseUrl);
    assert.equal(webhook.payload.failedCount, 2);
    assert.equal(webhook.rawBody.includes("secret-should-not-leak"), false);

    const timestamp = webhook.headers["x-opencontext-timestamp"];
    const signature = webhook.headers["x-opencontext-signature"];
    assert.ok(timestamp, "Missing X-OpenContext-Timestamp");
    assert.ok(signature, "Missing X-OpenContext-Signature");

    const expectedHex = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${webhook.rawBody}`, "utf8")
      .digest("hex");
    assert.equal(signature, `sha256=${expectedHex}`);
  } finally {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});
