import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.OPENCONTEXT_BASE_URL ?? "").replace(/\/$/, "");
const token = process.env.OPS_API_TOKEN?.trim();
const receiverUrl = process.env.ALERT_WEBHOOK_URL?.trim();
const githubSummary = process.env.GITHUB_STEP_SUMMARY;
const outputDir = path.resolve(".artifacts/operations");

assert.ok(baseUrl, "OPENCONTEXT_BASE_URL is required");
assert.ok(token, "OPS_API_TOKEN is required");

const response = await fetch(`${baseUrl}/api/ops/alerts`, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  },
  signal: AbortSignal.timeout(15_000),
});
const body = await response.json().catch(() => null);

if (response.status !== 200 && response.status !== 503) {
  throw new Error(`Operations endpoint returned HTTP ${response.status}`);
}
assert.ok(body && Array.isArray(body.alerts), "Operations response is invalid");

await mkdir(outputDir, { recursive: true });
const summaryPath = path.join(outputDir, "summary.json");
await writeFile(summaryPath, `${JSON.stringify(body, null, 2)}\n`);

const line = [
  "OpenContext operations",
  `healthy=${body.healthy}`,
  `queued=${body.counts.queued}`,
  `running=${body.counts.running}`,
  `failures=${body.counts.terminalFailures}`,
  `workers=${body.workers.renewedRecently}`,
  `alerts=${body.alerts.length}`,
].join(" ");
console.log(line);

if (githubSummary) {
  const alertLines = body.alerts
    .map((alert) => `- **${alert.severity}** \`${alert.code}\`: ${alert.message}`)
    .join("\n");
  await appendFile(
    githubSummary,
    `## OpenContext operations\n\n- Healthy: ${body.healthy}\n- Waiting jobs: ${body.counts.queued}\n- Active jobs: ${body.counts.running}\n- Recent failed jobs: ${body.counts.terminalFailures}\n- Recent worker heartbeats: ${body.workers.renewedRecently}\n- Last worker observation: ${body.lastWorkerClaimAt ?? "none"}\n${alertLines ? `\n${alertLines}\n` : ""}`,
  );
}

if (!body.healthy && receiverUrl) {
  const notification = await fetch(receiverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "opencontext.operations",
      healthy: body.healthy,
      counts: body.counts,
      workers: body.workers,
      alerts: body.alerts,
      checkedAt: body.generatedAt,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!notification.ok) {
    throw new Error(`Alert receiver returned HTTP ${notification.status}`);
  }
}

if (!body.healthy) {
  process.exitCode = 1;
  if (!receiverUrl) {
    console.error(
      "Operations alert has no receiver. Set ALERT_WEBHOOK_URL on the check host.",
    );
  }
}
