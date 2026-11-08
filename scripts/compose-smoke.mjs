import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const baseUrl = (process.env.OPENCONTEXT_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const videoPath = path.resolve(
  process.env.OPENCONTEXT_FIXTURE ?? ".artifacts/opencontext-fixture.mp4",
);
const outputDir = path.resolve(
  process.env.OPENCONTEXT_COMPOSE_OUTPUT ?? ".artifacts/compose-smoke",
);
const cookies = new Map();

function rememberCookies(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers);
  if (cookies.size > 0) {
    headers.set(
      "Cookie",
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  const response = await fetch(new URL(url, baseUrl), {
    ...options,
    headers,
    redirect: options.redirect ?? "manual",
  });
  rememberCookies(response);
  return response;
}

async function expectOk(response, label) {
  if (response.ok) {
    return response;
  }
  const body = await response.text();
  throw new Error(`${label} failed with HTTP ${response.status}: ${body}`);
}

async function signIn() {
  const csrfResponse = await expectOk(
    await request("/api/auth/csrf", { headers: { Accept: "application/json" } }),
    "CSRF request",
  );
  const { csrfToken } = await csrfResponse.json();
  assert.ok(csrfToken, "Auth.js returned no CSRF token");

  const form = new URLSearchParams({
    csrfToken,
    callbackUrl: `${baseUrl}/app`,
    json: "true",
  });
  const callback = await request("/api/auth/callback/local-dev", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!callback.ok && callback.status !== 302) {
    throw new Error(
      `Local sign-in failed with HTTP ${callback.status}: ${await callback.text()}`,
    );
  }

  const sessionResponse = await expectOk(
    await request("/api/auth/session", { headers: { Accept: "application/json" } }),
    "Session request",
  );
  const session = await sessionResponse.json();
  assert.ok(session?.user?.id, "Local sign-in did not establish a session");
  return session.user.id;
}

async function pollJob(jobId) {
  const deadline = Date.now() + 5 * 60_000;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    const response = await expectOk(
      await request(`/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Accept: "application/json" },
      }),
      "Job status request",
    );
    const job = await response.json();
    lastStatus = job.status;
    if (job.status === "COMPLETED") {
      return job;
    }
    if (job.status === "FAILED" || job.status === "PARTIAL") {
      throw new Error(`Job ended as ${job.status}: ${job.error ?? "no detail"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Job did not complete before timeout; last status ${lastStatus}`);
}

async function main() {
  const video = await readFile(videoPath);
  const userId = await signIn();

  const intentResponse = await expectOk(
    await request("/api/uploads", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: path.basename(videoPath),
        sizeBytes: video.byteLength,
        mime: "video/mp4",
        detailLevel: "MEDIUM",
      }),
    }),
    "Upload intent",
  );
  const intent = await intentResponse.json();

  await expectOk(
    await request(intent.url, {
      method: intent.method,
      headers: intent.headers,
      body: video,
    }),
    "Upload body",
  );

  const completeResponse = await expectOk(
    await request(`/api/uploads/${encodeURIComponent(intent.uploadId)}/complete`, {
      method: "POST",
      headers: { Accept: "application/json" },
    }),
    "Upload completion",
  );
  const summary = await completeResponse.json();
  const job = await pollJob(summary.id);

  const markdownResponse = await expectOk(
    await request(`/api/jobs/${encodeURIComponent(job.id)}/export?format=markdown`),
    "Markdown export",
  );
  const markdown = await markdownResponse.text();
  const jsonResponse = await expectOk(
    await request(`/api/jobs/${encodeURIComponent(job.id)}/export?format=json`),
    "JSON export",
  );
  const payload = await jsonResponse.json();

  assert.match(markdown, /E\d{4}/, "Markdown export contains no evidence IDs");
  assert.ok(Array.isArray(payload.evidence) && payload.evidence.length > 0);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "context.md"), markdown);
  await writeFile(
    path.join(outputDir, "context.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        userId,
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        evidenceCount: payload.evidence.length,
        markdown: path.join(outputDir, "context.md"),
        json: path.join(outputDir, "context.json"),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
