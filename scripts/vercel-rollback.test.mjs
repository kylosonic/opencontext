import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveRollbackConfig,
  runVercelRollback,
  selectRollbackTarget,
} from "./vercel-rollback.mjs";

async function startMockVercelServer(deployments, onRollback) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      rawBody,
    });

    if (req.method === "GET" && req.url?.startsWith("/v6/deployments")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ deployments }));
    }

    if (req.method === "POST" && req.url?.startsWith("/v9/projects/")) {
      const response = onRollback ? onRollback(req) : { status: 200, body: { ok: true } };
      res.writeHead(response.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(response.body));
    }

    res.writeHead(404);
    res.end('{"error":{"message":"not found"}}');
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const SAMPLE_DEPLOYMENTS = [
  {
    uid: "dpl_newest_bad",
    url: "opencontext-new.vercel.app",
    state: "READY",
    createdAt: 1795595206595,
    meta: { githubCommitSha: "7b5c7e9d4111f874b83ffb2933a988509b2a1f97" },
  },
  {
    uid: "dpl_prev_good",
    url: "opencontext-prev.vercel.app",
    state: "READY",
    createdAt: 1795594088859,
    meta: { githubCommitSha: "c5d326c1cfa2a3135f3b39734876197a5110e8c8" },
  },
  {
    uid: "dpl_older",
    url: "opencontext-older.vercel.app",
    state: "READY",
    createdAt: 1795591000000,
    meta: { githubCommitSha: "e82f6ca5659b65761e9244abfa535ae38b51611a" },
  },
];

test("resolveRollbackConfig requires VERCEL_TOKEN and VERCEL_PROJECT_ID and detects --dry-run", () => {
  assert.throws(() => resolveRollbackConfig({}), /VERCEL_TOKEN is required/);
  assert.throws(
    () => resolveRollbackConfig({ VERCEL_TOKEN: "tok" }),
    /VERCEL_PROJECT_ID is required/,
  );

  const cfg = resolveRollbackConfig(
    {
      VERCEL_TOKEN: "secret-tok",
      VERCEL_PROJECT_ID: "prj_123",
      VERCEL_ORG_ID: "team_456",
    },
    ["--dry-run"],
  );
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.orgId, "team_456");

  const envDryCfg = resolveRollbackConfig({
    VERCEL_TOKEN: "secret-tok",
    VERCEL_PROJECT_ID: "prj_123",
    VERCEL_ROLLBACK_DRY_RUN: "true",
  });
  assert.equal(envDryCfg.dryRun, true);
});

test("selectRollbackTarget matches by deployment URL, commit SHA, or falls back to index 0", () => {
  const byUrl = selectRollbackTarget(SAMPLE_DEPLOYMENTS, {
    failedDeploymentUrl: "https://opencontext-new.vercel.app/",
  });
  assert.equal(byUrl.current.uid, "dpl_newest_bad");
  assert.equal(byUrl.target.uid, "dpl_prev_good");

  const bySha = selectRollbackTarget(SAMPLE_DEPLOYMENTS, {
    failedCommitSha: "c5d326c1cfa2a3135f3b39734876197a5110e8c8",
  });
  assert.equal(bySha.current.uid, "dpl_prev_good");
  assert.equal(bySha.target.uid, "dpl_older");

  const fallback = selectRollbackTarget(SAMPLE_DEPLOYMENTS, {
    failedDeploymentUrl: "https://unmatched.vercel.app",
  });
  assert.equal(fallback.current.uid, "dpl_newest_bad");
  assert.equal(fallback.target.uid, "dpl_prev_good");

  assert.throws(
    () => selectRollbackTarget([SAMPLE_DEPLOYMENTS[0]], {}),
    /No predecessor READY production deployment/,
  );
});

test("runVercelRollback --dry-run resolves target without issuing POST rollback", async () => {
  const server = await startMockVercelServer(SAMPLE_DEPLOYMENTS);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oc-rb-dry-"));
  const outputPath = path.join(tmpDir, "rollback.json");
  const stepSummaryPath = path.join(tmpDir, "step-summary.md");

  try {
    const result = await runVercelRollback({
      env: {
        VERCEL_TOKEN: "vercel-secret-token",
        VERCEL_PROJECT_ID: "prj_test",
        VERCEL_ORG_ID: "team_test",
        VERCEL_API_URL: server.baseUrl,
        GITHUB_STEP_SUMMARY: stepSummaryPath,
      },
      argv: ["--dry-run"],
      outputPath,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.rolledBack, false);
    assert.equal(result.current.uid, "dpl_newest_bad");
    assert.equal(result.target.uid, "dpl_prev_good");
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].method, "GET");
    assert.match(server.requests[0].url, /projectId=prj_test/);
    assert.match(server.requests[0].url, /teamId=team_test/);

    const written = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(written.target.uid, "dpl_prev_good");

    const md = await readFile(stepSummaryPath, "utf8");
    assert.match(md, /DRY RUN/);
    assert.match(md, /dpl_prev_good/);
  } finally {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("runVercelRollback sends POST /v9/projects/:id/rollback/:uid when not dry-run", async () => {
  const server = await startMockVercelServer(SAMPLE_DEPLOYMENTS);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oc-rb-live-"));
  const outputPath = path.join(tmpDir, "rollback.json");

  try {
    const result = await runVercelRollback({
      env: {
        VERCEL_TOKEN: "vercel-secret-token",
        VERCEL_PROJECT_ID: "prj_test",
        VERCEL_ORG_ID: "team_test",
        FAILED_DEPLOYMENT_URL: "https://opencontext-new.vercel.app",
        VERCEL_API_URL: server.baseUrl,
      },
      outputPath,
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.rolledBack, true);
    assert.equal(result.target.uid, "dpl_prev_good");
    assert.equal(server.requests.length, 2);

    const postReq = server.requests[1];
    assert.equal(postReq.method, "POST");
    assert.equal(postReq.url, "/v9/projects/prj_test/rollback/dpl_prev_good?teamId=team_test");
    assert.equal(postReq.authorization, "Bearer vercel-secret-token");
    assert.equal(postReq.rawBody, "{}");

    const written = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(written.rolledBack, true);
    assert.equal(written.target.uid, "dpl_prev_good");
  } finally {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});
