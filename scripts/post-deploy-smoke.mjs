import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildAlertWebhookRequest } from "./operations-webhook.mjs";

const DEFAULT_RETRIES = 6;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const SCIM_SERVICE_PROVIDER_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

function parseNonNegativeInt(raw, fallback, name) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

/**
 * Validate and normalize post-deploy smoke test configuration from environment variables.
 */
export function resolveSmokeConfig(env = process.env) {
  const rawBaseUrl = (env.OPENCONTEXT_BASE_URL ?? "").trim();
  assert.ok(rawBaseUrl, "OPENCONTEXT_BASE_URL is required");

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("OPENCONTEXT_BASE_URL must be a valid URL");
  }
  if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.protocol !== "http:") {
    throw new Error("OPENCONTEXT_BASE_URL must use http or https");
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error("OPENCONTEXT_BASE_URL must not embed credentials");
  }

  const baseUrl = parsedBaseUrl.origin;
  const opsApiToken = env.OPS_API_TOKEN?.trim() || undefined;
  const alertWebhookUrl = env.ALERT_WEBHOOK_URL?.trim() || undefined;
  const alertWebhookSecret = env.ALERT_WEBHOOK_SECRET?.trim() || undefined;
  const githubStepSummary = env.GITHUB_STEP_SUMMARY?.trim() || undefined;
  const retries = parseNonNegativeInt(env.SMOKE_RETRIES, DEFAULT_RETRIES, "SMOKE_RETRIES");
  const retryDelayMs = parseNonNegativeInt(
    env.SMOKE_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS,
    "SMOKE_RETRY_DELAY_MS",
  );
  const timeoutMs = parseNonNegativeInt(
    env.SMOKE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    "SMOKE_TIMEOUT_MS",
  );

  return {
    baseUrl,
    opsApiToken,
    alertWebhookUrl,
    alertWebhookSecret,
    githubStepSummary,
    retries,
    retryDelayMs,
    timeoutMs: timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function assertJsonContentType(contentType) {
  assert.ok(
    contentType.toLowerCase().includes("json"),
    `Expected JSON Content-Type, got "${contentType || "missing"}"`,
  );
}

function assertHtmlResponse(contentType, bodyText) {
  assert.ok(
    contentType.toLowerCase().includes("text/html"),
    `Expected text/html Content-Type, got "${contentType || "missing"}"`,
  );
  assert.ok(
    bodyText.toLowerCase().includes("<html"),
    "Expected HTML response containing <html",
  );
}

function buildSmokeChecks(baseUrl, opsApiToken) {
  const checks = [
    {
      name: "Readiness (public)",
      path: "/api/health/ready",
      url: `${baseUrl}/api/health/ready`,
      headers: { Accept: "application/json" },
      verify: async (response) => {
        assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);
        assertJsonContentType(response.headers.get("content-type") ?? "");
        const body = await response.json();
        assert.equal(body?.ready, true, "Expected ready === true");
        assert.ok(
          typeof body?.checkedAt === "string" && body.checkedAt.trim().length > 0,
          "Expected non-empty checkedAt string",
        );
      },
    },
  ];

  if (opsApiToken) {
    checks.push({
      name: "Readiness (authenticated)",
      path: "/api/health/ready",
      url: `${baseUrl}/api/health/ready`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${opsApiToken}`,
      },
      verify: async (response) => {
        assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);
        assertJsonContentType(response.headers.get("content-type") ?? "");
        const body = await response.json();
        assert.equal(body?.ready, true, "Expected ready === true");
        assert.ok(
          Array.isArray(body?.blockers) && body.blockers.length === 0,
          `Expected zero readiness blockers, got ${JSON.stringify(body?.blockers ?? null)}`,
        );
      },
    });
  }

  checks.push(
    {
      name: "SCIM ServiceProviderConfig",
      path: "/api/scim/v2/ServiceProviderConfig",
      url: `${baseUrl}/api/scim/v2/ServiceProviderConfig`,
      headers: { Accept: "application/scim+json, application/json" },
      verify: async (response) => {
        assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);
        assertJsonContentType(response.headers.get("content-type") ?? "");
        const body = await response.json();
        assert.ok(Array.isArray(body?.schemas), "Expected schemas array");
        assert.ok(
          body.schemas.includes(SCIM_SERVICE_PROVIDER_SCHEMA),
          `Missing expected schema ${SCIM_SERVICE_PROVIDER_SCHEMA}`,
        );
      },
    },
    {
      name: "Auth providers",
      path: "/api/auth/providers",
      url: `${baseUrl}/api/auth/providers`,
      headers: { Accept: "application/json" },
      verify: async (response) => {
        assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);
        assertJsonContentType(response.headers.get("content-type") ?? "");
        const body = await response.json();
        assert.ok(
          body !== null && typeof body === "object" && !Array.isArray(body),
          "Expected non-null JSON object",
        );
        assert.ok(
          Object.keys(body).length > 0,
          "Expected at least one configured auth provider",
        );
      },
    },
    {
      name: "Sign-in page",
      path: "/auth/signin",
      url: `${baseUrl}/auth/signin`,
      headers: { Accept: "text/html" },
      verify: async (response) => {
        assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);
        const text = await response.text();
        assertHtmlResponse(response.headers.get("content-type") ?? "", text);
      },
    },
    {
      name: "Home page",
      path: "/",
      url: `${baseUrl}/`,
      headers: { Accept: "text/html" },
      verify: async (response) => {
        assert.equal(response.status, 200, `Expected HTTP 200, got ${response.status}`);
        const text = await response.text();
        assertHtmlResponse(response.headers.get("content-type") ?? "", text);
      },
    },
  );

  return checks;
}

/**
 * Execute a single HTTP endpoint smoke check with bounded retries and timeout.
 */
export async function checkEndpoint(
  check,
  {
    retries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {},
) {
  const maxAttempts = 1 + Math.max(0, retries);
  const startedAt = Date.now();
  let lastStatus = null;
  let lastError = "Unknown smoke check failure";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastStatus = null;
    try {
      const response = await fetchImpl(check.url, {
        method: "GET",
        headers: check.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;
      await check.verify(response);
      return {
        name: check.name,
        path: check.path,
        passed: true,
        status: response.status,
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        error: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await delay(retryDelayMs);
      }
    }
  }

  return {
    name: check.name,
    path: check.path,
    passed: false,
    status: lastStatus,
    attempts: maxAttempts,
    durationMs: Date.now() - startedAt,
    error: lastError,
  };
}

function formatMarkdownSummary(report) {
  const header = [
    "## Post-deploy smoke verification",
    "",
    `- Target: \`${report.baseUrl}\``,
    `- Outcome: **${report.passed ? "PASSED" : "FAILED"}** (${report.checks.length - report.failedCount}/${report.checks.length} passed)`,
    `- Checked at: \`${report.checkedAt}\``,
    "",
    "| Check | Path | Status | Attempts | Duration (ms) | Result |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const rows = report.checks.map((check) => {
    const statusText = check.status === null ? "n/a" : String(check.status);
    const resultText = check.passed ? "pass" : `fail: ${check.error}`;
    return `| ${check.name} | \`${check.path}\` | ${statusText} | ${check.attempts} | ${check.durationMs} | ${resultText} |`;
  });
  return `${header.concat(rows).join("\n")}\n`;
}

/**
 * Run all post-deploy smoke checks, write artifacts/step summaries, and send alert webhooks on failure.
 */
export async function runSmokeChecks({
  env = process.env,
  fetchImpl = fetch,
  summaryPath = path.resolve(".artifacts/deploy-smoke/summary.json"),
} = {}) {
  const config = resolveSmokeConfig(env);
  const checkSpecs = buildSmokeChecks(config.baseUrl, config.opsApiToken);
  const checks = [];

  for (const spec of checkSpecs) {
    const result = await checkEndpoint(spec, {
      retries: config.retries,
      retryDelayMs: config.retryDelayMs,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });
    checks.push(result);
    const label = result.passed ? "PASS" : "FAIL";
    const statusLabel = result.status === null ? "err" : `HTTP ${result.status}`;
    const detail = result.error ? ` - ${result.error}` : "";
    console.log(
      `[post-deploy-smoke] ${label} ${result.name} (${result.path}) [${statusLabel}, attempts=${result.attempts}, ${result.durationMs}ms]${detail}`,
    );
  }

  const failedCount = checks.filter((item) => !item.passed).length;
  const checkedAt = new Date().toISOString();
  const report = {
    passed: failedCount === 0,
    baseUrl: config.baseUrl,
    checkedAt,
    failedCount,
    checks,
    webhookSent: false,
    webhookError: null,
  };

  if (summaryPath) {
    await mkdir(path.dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (config.githubStepSummary) {
    await appendFile(config.githubStepSummary, formatMarkdownSummary(report), "utf8");
  }

  if (!report.passed && config.alertWebhookUrl) {
    try {
      const webhookRequest = buildAlertWebhookRequest({
        url: config.alertWebhookUrl,
        secret: config.alertWebhookSecret,
        payload: {
          event: "opencontext.deploy_smoke_failed",
          baseUrl: report.baseUrl,
          checks: report.checks,
          failedCount: report.failedCount,
          checkedAt: report.checkedAt,
        },
      });
      const response = await fetchImpl(webhookRequest.url, {
        method: "POST",
        headers: webhookRequest.headers,
        body: webhookRequest.body,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Alert webhook returned HTTP ${response.status}`);
      }
      report.webhookSent = true;
    } catch (error) {
      report.webhookError = error instanceof Error ? error.message : String(error);
      console.error(`[post-deploy-smoke] Failed to deliver alert webhook: ${report.webhookError}`);
    }
  }

  return report;
}

async function runCli() {
  try {
    const report = await runSmokeChecks();
    if (!report.passed) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `[post-deploy-smoke] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await runCli();
}
