import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveIncidentConfig, syncIncidentIssue } from "./github-incident-alert.mjs";

async function startMockGitHubServer() {
  const state = {
    issues: [],
    comments: [],
    labelsCreated: [],
    nextIssueNumber: 101,
    requests: [],
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const parsedBody = rawBody ? JSON.parse(rawBody) : null;
    state.requests.push({ method: req.method, url: req.url, body: parsedBody });

    const reqUrl = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && reqUrl.pathname === "/repos/kylosonic/opencontext/issues") {
      const open = state.issues.filter((i) => i.state === "open");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(open));
    }

    if (req.method === "POST" && reqUrl.pathname === "/repos/kylosonic/opencontext/labels") {
      if (state.labelsCreated.includes(parsedBody.name)) {
        res.writeHead(422, { "Content-Type": "application/json" });
        return res.end('{"message":"Validation Failed"}');
      }
      state.labelsCreated.push(parsedBody.name);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(parsedBody));
    }

    if (req.method === "POST" && reqUrl.pathname === "/repos/kylosonic/opencontext/issues") {
      const created = {
        number: state.nextIssueNumber++,
        title: parsedBody.title,
        body: parsedBody.body,
        labels: parsedBody.labels,
        state: "open",
      };
      state.issues.push(created);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(created));
    }

    const commentMatch = /^\/repos\/kylosonic\/opencontext\/issues\/(\d+)\/comments$/.exec(
      reqUrl.pathname,
    );
    if (req.method === "POST" && commentMatch) {
      state.comments.push({
        issueNumber: Number(commentMatch[1]),
        body: parsedBody.body,
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: state.comments.length }));
    }

    const patchMatch = /^\/repos\/kylosonic\/opencontext\/issues\/(\d+)$/.exec(
      reqUrl.pathname,
    );
    if (req.method === "PATCH" && patchMatch) {
      const num = Number(patchMatch[1]);
      const target = state.issues.find((i) => i.number === num);
      if (target) {
        target.state = parsedBody.state;
        target.state_reason = parsedBody.state_reason;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(target ?? {}));
    }

    res.writeHead(404);
    res.end('{"message":"Not Found"}');
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("resolveIncidentConfig validates required fields", () => {
  assert.throws(() => resolveIncidentConfig({}), /GITHUB_TOKEN is required/);
  assert.throws(
    () =>
      resolveIncidentConfig({
        GITHUB_TOKEN: "tok",
        GITHUB_REPOSITORY: "bad",
        INCIDENT_KEY: "deploy-smoke",
        INCIDENT_STATUS: "unhealthy",
        INCIDENT_TITLE: "Failure",
      }),
    /owner\/repo/,
  );
  assert.throws(
    () =>
      resolveIncidentConfig({
        GITHUB_TOKEN: "tok",
        GITHUB_REPOSITORY: "kylosonic/opencontext",
        INCIDENT_KEY: "deploy-smoke",
        INCIDENT_STATUS: "unknown",
        INCIDENT_TITLE: "Failure",
      }),
    /healthy/,
  );
});

test("syncIncidentIssue creates once, deduplicates repeated failures, and auto-closes on recovery", async () => {
  const gh = await startMockGitHubServer();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "oc-gh-incident-"));
  const summaryPath = path.join(tmpDir, "summary.json");
  const rollbackPath = path.join(tmpDir, "rollback.json");

  await writeFile(
    summaryPath,
    JSON.stringify({
      passed: false,
      baseUrl: "https://opencontext-swart.vercel.app",
      checks: [
        { name: "Readiness (public)", path: "/api/health/ready", passed: false, status: 503, error: "Expected 200" },
      ],
    }),
  );
  await writeFile(
    rollbackPath,
    JSON.stringify({
      rolledBack: true,
      dryRun: false,
      target: {
        uid: "dpl_prev_good",
        url: "https://opencontext-prev.vercel.app",
        shortSha: "c5d326c",
      },
    }),
  );

  const baseEnv = {
    GITHUB_TOKEN: "ghp_test_token",
    GITHUB_REPOSITORY: "kylosonic/opencontext",
    GITHUB_API_URL: gh.baseUrl,
    INCIDENT_KEY: "deploy-smoke",
    INCIDENT_TITLE: "Production post-deploy smoke check failed",
    INCIDENT_SUMMARY_PATH: summaryPath,
    INCIDENT_ROLLBACK_PATH: rollbackPath,
    INCIDENT_RUN_URL: "https://github.com/kylosonic/opencontext/actions/runs/123",
  };

  try {
    // 1. Healthy with no open issue -> noop
    const noopRes = await syncIncidentIssue({
      env: { ...baseEnv, INCIDENT_STATUS: "healthy" },
    });
    assert.equal(noopRes.action, "noop");
    assert.equal(gh.state.issues.length, 0);

    // 2. First unhealthy run -> creates issue #101 with labels + sanitized summary
    const createRes = await syncIncidentIssue({
      env: { ...baseEnv, INCIDENT_STATUS: "unhealthy" },
    });
    assert.equal(createRes.action, "created");
    assert.equal(createRes.issueNumber, 101);
    assert.equal(gh.state.issues.length, 1);
    assert.deepEqual(gh.state.issues[0].labels, ["ops-incident", "automated"]);
    assert.match(gh.state.issues[0].body, /<!-- opencontext-incident: deploy-smoke -->/);
    assert.match(gh.state.issues[0].body, /dpl_prev_good/);

    // 3. Repeated unhealthy run -> comments on #101 instead of creating duplicate issue
    const commentRes = await syncIncidentIssue({
      env: { ...baseEnv, INCIDENT_STATUS: "unhealthy" },
    });
    assert.equal(commentRes.action, "commented");
    assert.equal(commentRes.issueNumber, 101);
    assert.equal(gh.state.issues.length, 1);
    assert.equal(gh.state.comments.length, 1);

    // 4. Subsequent healthy run -> posts recovery comment and closes #101
    const recoverRes = await syncIncidentIssue({
      env: {
        ...baseEnv,
        INCIDENT_STATUS: "healthy",
        INCIDENT_RUN_URL: "https://github.com/kylosonic/opencontext/actions/runs/124",
      },
    });
    assert.equal(recoverRes.action, "closed");
    assert.deepEqual(recoverRes.closedIssues, [101]);
    assert.equal(gh.state.issues[0].state, "closed");
    assert.equal(gh.state.issues[0].state_reason, "completed");
    assert.equal(gh.state.comments.length, 2);
    assert.match(gh.state.comments[1].body, /Recovered on .*runs\/124/);
  } finally {
    await gh.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
});
