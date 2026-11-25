import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_VERCEL_API_URL = "https://api.vercel.com";
const DEFAULT_TIMEOUT_MS = 20_000;
const TRUTHY_FLAGS = new Set(["true", "1", "yes", "on"]);

function normalizeHost(rawValue) {
  if (typeof rawValue !== "string") return "";
  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

function summarizeDeployment(dep) {
  const uid = dep?.uid ?? dep?.id ?? null;
  const sha = typeof dep?.meta?.githubCommitSha === "string" ? dep.meta.githubCommitSha : null;
  return {
    uid,
    url: dep?.url ? `https://${normalizeHost(dep.url)}` : null,
    commitSha: sha,
    shortSha: sha ? sha.slice(0, 7) : null,
    createdAt: dep?.createdAt ?? dep?.created ?? null,
    state: dep?.state ?? dep?.readyState ?? null,
  };
}

/**
 * Validate and resolve Vercel Instant Rollback settings from env and CLI flags.
 */
export function resolveRollbackConfig(env = process.env, argv = process.argv.slice(2)) {
  const token = env.VERCEL_TOKEN?.trim() ?? "";
  assert.ok(token, "VERCEL_TOKEN is required");

  const projectId = env.VERCEL_PROJECT_ID?.trim() ?? "";
  assert.ok(projectId, "VERCEL_PROJECT_ID is required");

  const orgId = env.VERCEL_ORG_ID?.trim() || undefined;
  const failedDeploymentUrl = env.FAILED_DEPLOYMENT_URL?.trim() || undefined;
  const failedCommitSha = env.FAILED_COMMIT_SHA?.trim() || undefined;
  const githubStepSummary = env.GITHUB_STEP_SUMMARY?.trim() || undefined;

  const rawApiUrl = (env.VERCEL_API_URL ?? DEFAULT_VERCEL_API_URL).trim();
  const parsedApiUrl = new URL(rawApiUrl);
  if (parsedApiUrl.protocol !== "https:" && parsedApiUrl.protocol !== "http:") {
    throw new Error("VERCEL_API_URL must use http or https");
  }
  const apiUrl = rawApiUrl.replace(/\/+$/, "");

  const flagDryRun = argv.includes("--dry-run");
  const envDryRun = TRUTHY_FLAGS.has((env.VERCEL_ROLLBACK_DRY_RUN ?? "").trim().toLowerCase());
  const dryRun = flagDryRun || envDryRun;

  return {
    token,
    projectId,
    orgId,
    failedDeploymentUrl,
    failedCommitSha,
    dryRun,
    apiUrl,
    githubStepSummary,
  };
}

/**
 * Pick the immediate predecessor READY production deployment for Vercel Instant Rollback.
 */
export function selectRollbackTarget(
  deployments,
  { failedDeploymentUrl, failedCommitSha } = {},
) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("No READY production deployments found for project.");
  }

  const normalizedFailedHost = normalizeHost(failedDeploymentUrl);
  const normalizedFailedSha = (failedCommitSha ?? "").trim().toLowerCase();

  let currentIndex = -1;
  if (normalizedFailedHost) {
    currentIndex = deployments.findIndex((dep) => {
      if (normalizeHost(dep?.url) === normalizedFailedHost) return true;
      if (Array.isArray(dep?.alias)) {
        return dep.alias.some((a) => normalizeHost(a) === normalizedFailedHost);
      }
      return false;
    });
  }

  if (currentIndex === -1 && normalizedFailedSha) {
    currentIndex = deployments.findIndex((dep) => {
      const candidateSha = (dep?.meta?.githubCommitSha ?? "").trim().toLowerCase();
      if (!candidateSha) return false;
      return (
        candidateSha === normalizedFailedSha ||
        (normalizedFailedSha.length >= 7 && candidateSha.startsWith(normalizedFailedSha)) ||
        (candidateSha.length >= 7 && normalizedFailedSha.startsWith(candidateSha))
      );
    });
  }

  if (currentIndex === -1) {
    currentIndex = 0;
  }

  const current = deployments[currentIndex];
  const target = deployments[currentIndex + 1];
  if (!target || !(target.uid ?? target.id)) {
    throw new Error(
      "No predecessor READY production deployment is available for rollback.",
    );
  }

  return { current, target };
}

function formatRollbackSummary(result) {
  const mode = result.dryRun ? "DRY RUN (no mutation)" : "ROLLED BACK";
  const lines = [
    `## Vercel Instant Rollback (${mode})`,
    "",
    `- Current/failed deployment: \`${result.current.uid}\` (${result.current.url ?? "n/a"}, commit \`${result.current.shortSha ?? "unknown"}\`)`,
    `- Rollback target deployment: \`${result.target.uid}\` (${result.target.url ?? "n/a"}, commit \`${result.target.shortSha ?? "unknown"}\`)`,
  ];
  if (result.rolledBack) {
    lines.push(
      "",
      "> **Note:** Vercel pauses automatic production alias assignment after an Instant Rollback. Promote a subsequent fix deployment explicitly with `vercel promote` to resume auto-assignment.",
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * List READY production deployments, select the immediate predecessor, and trigger or dry-run rollback.
 */
export async function runVercelRollback({
  env = process.env,
  argv = [],
  fetchImpl = fetch,
  outputPath = path.resolve(".artifacts/deploy-smoke/rollback.json"),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = resolveRollbackConfig(env, argv);
  const teamParam = config.orgId ? `&teamId=${encodeURIComponent(config.orgId)}` : "";
  const listUrl = `${config.apiUrl}/v6/deployments?projectId=${encodeURIComponent(config.projectId)}&target=production&state=READY&limit=10${teamParam}`;

  const listResponse = await fetchImpl(listUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const listBody = await listResponse.json().catch(() => null);
  if (!listResponse.ok) {
    const apiMessage = listBody?.error?.message ?? `HTTP ${listResponse.status}`;
    throw new Error(`Failed to list Vercel deployments: ${apiMessage}`);
  }

  const { current, target } = selectRollbackTarget(listBody?.deployments, {
    failedDeploymentUrl: config.failedDeploymentUrl,
    failedCommitSha: config.failedCommitSha,
  });

  const currentSummary = summarizeDeployment(current);
  const targetSummary = summarizeDeployment(target);
  const checkedAt = new Date().toISOString();

  if (config.dryRun) {
    console.log(
      `[vercel-rollback] DRY RUN: current=${currentSummary.uid} (${currentSummary.shortSha ?? "no-sha"}) -> target=${targetSummary.uid} (${targetSummary.url ?? "n/a"}, ${targetSummary.shortSha ?? "no-sha"})`,
    );
    const result = {
      rolledBack: false,
      dryRun: true,
      current: currentSummary,
      target: targetSummary,
      checkedAt,
    };
    if (outputPath) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    if (config.githubStepSummary) {
      await appendFile(config.githubStepSummary, formatRollbackSummary(result), "utf8");
    }
    return result;
  }

  const rollbackTeamQuery = config.orgId ? `?teamId=${encodeURIComponent(config.orgId)}` : "";
  const rollbackUrl = `${config.apiUrl}/v9/projects/${encodeURIComponent(config.projectId)}/rollback/${encodeURIComponent(targetSummary.uid)}${rollbackTeamQuery}`;
  const rollbackResponse = await fetchImpl(rollbackUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!rollbackResponse.ok) {
    const rollbackBody = await rollbackResponse.json().catch(() => null);
    const apiMessage = rollbackBody?.error?.message ?? `HTTP ${rollbackResponse.status}`;
    throw new Error(`Vercel Instant Rollback failed: ${apiMessage}`);
  }

  console.log(
    `[vercel-rollback] Rolled back ${currentSummary.uid} -> ${targetSummary.uid} (${targetSummary.url ?? "n/a"}, ${targetSummary.shortSha ?? "no-sha"})`,
  );
  const result = {
    rolledBack: true,
    dryRun: false,
    current: currentSummary,
    target: targetSummary,
    checkedAt,
  };
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  if (config.githubStepSummary) {
    await appendFile(config.githubStepSummary, formatRollbackSummary(result), "utf8");
  }
  return result;
}

async function runCli() {
  try {
    await runVercelRollback({ argv: process.argv.slice(2) });
  } catch (error) {
    console.error(
      `[vercel-rollback] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await runCli();
}
