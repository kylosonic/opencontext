import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_GITHUB_API_URL = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const INCIDENT_LABELS = [
  {
    name: "ops-incident",
    color: "d93f0b",
    description: "Automated OpenContext operational or deployment health incident",
  },
  {
    name: "automated",
    color: "0e8a16",
    description: "Created and managed automatically by CI/CD workflows",
  },
];

function markerForKey(incidentKey) {
  return `<!-- opencontext-incident: ${incidentKey} -->`;
}

/**
 * Validate and normalize GitHub Issue incident alerting settings from env.
 */
export function resolveIncidentConfig(env = process.env) {
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  assert.ok(token, "GITHUB_TOKEN is required");

  const repository = env.GITHUB_REPOSITORY?.trim() ?? "";
  assert.ok(repository, "GITHUB_REPOSITORY is required");
  const repoParts = repository.split("/");
  if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
    throw new Error("GITHUB_REPOSITORY must have the form owner/repo");
  }

  const incidentKey = env.INCIDENT_KEY?.trim() ?? "";
  assert.ok(incidentKey, "INCIDENT_KEY is required");

  const status = (env.INCIDENT_STATUS ?? "").trim().toLowerCase();
  if (status !== "healthy" && status !== "unhealthy") {
    throw new Error('INCIDENT_STATUS must be "healthy" or "unhealthy"');
  }

  const title = env.INCIDENT_TITLE?.trim() ?? "";
  assert.ok(title, "INCIDENT_TITLE is required");

  const rawApiUrl = (env.GITHUB_API_URL ?? DEFAULT_GITHUB_API_URL).trim();
  const parsedApiUrl = new URL(rawApiUrl);
  if (parsedApiUrl.protocol !== "https:" && parsedApiUrl.protocol !== "http:") {
    throw new Error("GITHUB_API_URL must use http or https");
  }
  const apiUrl = rawApiUrl.replace(/\/+$/, "");

  return {
    token,
    owner: repoParts[0],
    repo: repoParts[1],
    repository,
    incidentKey,
    status,
    title,
    summaryPath: env.INCIDENT_SUMMARY_PATH?.trim() || undefined,
    rollbackPath: env.INCIDENT_ROLLBACK_PATH?.trim() || undefined,
    runUrl: env.INCIDENT_RUN_URL?.trim() || undefined,
    apiUrl,
  };
}

async function readOptionalJson(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build sanitized Markdown body for an incident issue or update comment.
 */
export function buildIncidentMarkdown({
  incidentKey,
  title,
  runUrl,
  summary,
  rollback,
  timestamp = new Date().toISOString(),
}) {
  const lines = [
    markerForKey(incidentKey),
    `## ${title}`,
    "",
    `- **Incident key:** \`${incidentKey}\``,
    `- **Observed at:** \`${timestamp}\``,
  ];
  if (runUrl) {
    lines.push(`- **Workflow run:** ${runUrl}`);
  }

  if (summary && Array.isArray(summary.checks)) {
    lines.push("", "### Post-deploy smoke checks");
    if (summary.baseUrl) {
      lines.push(`- **Target:** \`${summary.baseUrl}\``);
    }
    for (const check of summary.checks) {
      const state = check.passed ? "PASS" : "FAIL";
      const statusText = check.status === null || check.status === undefined ? "err" : `HTTP ${check.status}`;
      const detail = !check.passed && check.error ? ` — ${check.error}` : "";
      lines.push(`- **${state}** \`${check.name}\` (\`${check.path}\`, ${statusText})${detail}`);
    }
  } else if (summary && summary.counts && Array.isArray(summary.alerts)) {
    lines.push(
      "",
      "### Operations status",
      `- **Healthy:** \`${summary.healthy}\``,
      `- **Queued jobs:** \`${summary.counts.queued}\``,
      `- **Active jobs:** \`${summary.counts.running}\``,
      `- **Recent failed jobs:** \`${summary.counts.terminalFailures}\``,
      `- **Recent worker heartbeats:** \`${summary.workers?.renewedRecently ?? 0}\``,
    );
    for (const alert of summary.alerts) {
      lines.push(`- **${alert.severity}** \`${alert.code}\`: ${alert.message}`);
    }
  }

  if (rollback && rollback.target) {
    lines.push(
      "",
      "### Rollback action",
      `- **Rolled back:** \`${Boolean(rollback.rolledBack)}\` (dryRun=\`${Boolean(rollback.dryRun)}\`)`,
      `- **Target deployment:** \`${rollback.target.uid}\` (${rollback.target.url ?? "n/a"}, commit \`${rollback.target.shortSha ?? "unknown"}\`)`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function githubRequest(config, method, apiPath, body, { fetchImpl, timeoutMs, allowStatuses = [] }) {
  const response = await fetchImpl(`${config.apiUrl}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opencontext-ci-incident-alert",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (allowStatuses.includes(response.status)) {
    return { status: response.status, data: null };
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = data?.message ?? `HTTP ${response.status}`;
    throw new Error(`GitHub API ${method} ${apiPath} failed: ${msg}`);
  }
  return { status: response.status, data };
}

async function ensureLabels(config, options) {
  for (const label of INCIDENT_LABELS) {
    await githubRequest(
      config,
      "POST",
      `/repos/${config.owner}/${config.repo}/labels`,
      label,
      { ...options, allowStatuses: [422] },
    );
  }
}

/**
 * Create, deduplicate/comment, or auto-close the GitHub incident issue for `INCIDENT_KEY`.
 */
export async function syncIncidentIssue({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = resolveIncidentConfig(env);
  const marker = markerForKey(config.incidentKey);
  const reqOpts = { fetchImpl, timeoutMs };

  const listPath = `/repos/${config.owner}/${config.repo}/issues?state=open&labels=ops-incident&per_page=50`;
  const { data: openIssues } = await githubRequest(config, "GET", listPath, undefined, reqOpts);
  const matching = (Array.isArray(openIssues) ? openIssues : []).filter(
    (issue) =>
      !issue.pull_request &&
      typeof issue.body === "string" &&
      issue.body.includes(marker),
  );

  if (config.status === "healthy") {
    if (matching.length === 0) {
      console.log(`[github-incident] No open incident issue for ${config.incidentKey}.`);
      return { action: "noop", incidentKey: config.incidentKey, closedIssues: [] };
    }

    const recoveryTimestamp = new Date().toISOString();
    const recoveryComment = config.runUrl
      ? `${marker}\nRecovered on ${config.runUrl} (checked at \`${recoveryTimestamp}\`). Closing automatically.\n`
      : `${marker}\nRecovered at \`${recoveryTimestamp}\`. Closing automatically.\n`;

    const closedIssues = [];
    for (const issue of matching) {
      await githubRequest(
        config,
        "POST",
        `/repos/${config.owner}/${config.repo}/issues/${issue.number}/comments`,
        { body: recoveryComment },
        reqOpts,
      );
      await githubRequest(
        config,
        "PATCH",
        `/repos/${config.owner}/${config.repo}/issues/${issue.number}`,
        { state: "closed", state_reason: "completed" },
        reqOpts,
      );
      closedIssues.push(issue.number);
      console.log(
        `[github-incident] Closed recovered incident #${issue.number} (${config.incidentKey}).`,
      );
    }
    return { action: "closed", incidentKey: config.incidentKey, closedIssues };
  }

  await ensureLabels(config, reqOpts);
  const [summary, rollback] = await Promise.all([
    readOptionalJson(config.summaryPath),
    readOptionalJson(config.rollbackPath),
  ]);
  const body = buildIncidentMarkdown({
    incidentKey: config.incidentKey,
    title: config.title,
    runUrl: config.runUrl,
    summary,
    rollback,
  });

  if (matching.length > 0) {
    const existing = matching[0];
    await githubRequest(
      config,
      "POST",
      `/repos/${config.owner}/${config.repo}/issues/${existing.number}/comments`,
      { body },
      reqOpts,
    );
    console.log(
      `[github-incident] Updated existing incident #${existing.number} (${config.incidentKey}).`,
    );
    return {
      action: "commented",
      incidentKey: config.incidentKey,
      issueNumber: existing.number,
    };
  }

  const { data: created } = await githubRequest(
    config,
    "POST",
    `/repos/${config.owner}/${config.repo}/issues`,
    {
      title: config.title,
      body,
      labels: INCIDENT_LABELS.map((item) => item.name),
    },
    reqOpts,
  );
  console.log(
    `[github-incident] Created incident #${created.number} (${config.incidentKey}).`,
  );
  return {
    action: "created",
    incidentKey: config.incidentKey,
    issueNumber: created.number,
  };
}

async function runCli() {
  try {
    await syncIncidentIssue();
  } catch (error) {
    console.error(
      `[github-incident] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await runCli();
}
