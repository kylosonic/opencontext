import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const childPath = path.join(repoRoot, "scripts", "rate-limit-load-child.mjs");
const bundleDir = path.join(repoRoot, ".artifacts", "rate-limit-load-build");
const bundlePath = path.join(bundleDir, "rate-limit.mjs");
const options = parseArgs({
  options: {
    instances: { type: "string", default: "6" },
    requests: { type: "string", default: "25" },
    limit: { type: "string", default: "37" },
    rounds: { type: "string", default: "4" },
    out: { type: "string" },
  },
}).values;

const instances = Number(options.instances);
const requestsPerInstance = Number(options.requests);
const limit = Number(options.limit);
const rounds = Number(options.rounds);

for (const [name, value] of Object.entries({
  instances,
  requestsPerInstance,
  limit,
  rounds,
})) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl.startsWith("postgres")) {
  throw new Error("DATABASE_URL must point to PostgreSQL");
}
if (process.env.RATE_LIMIT_LOAD_ALLOW_RESET !== "1") {
  throw new Error(
    "Set RATE_LIMIT_LOAD_ALLOW_RESET=1 to permit resetting rate-limit rows",
  );
}

await build({
  root: repoRoot,
  configFile: false,
  logLevel: "error",
  resolve: {
    alias: {
      "@": path.join(repoRoot, "apps", "web", "src"),
    },
  },
  build: {
    ssr: path.join(repoRoot, "scripts", "rate-limit-load-entry.ts"),
    outDir: bundleDir,
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "rate-limit.mjs" },
    },
  },
});
const bundleUrl = pathToFileURL(bundlePath).href;

function withConnectionLimit(url) {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("connection_limit")) {
    parsed.searchParams.set("connection_limit", "2");
  }
  return parsed.toString();
}

class ChildClient {
  constructor(workerId) {
    this.workerId = workerId;
    this.messages = [];
    this.waiters = [];
    this.stderr = "";
    this.process = spawn(process.execPath, [childPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: withConnectionLimit(databaseUrl),
        RATE_LIMIT_LOAD_MODULE: bundleUrl,
        RATE_LIMIT_BACKEND: "database",
        RATE_LIMIT_FAILURE_MODE: "closed",
        RATE_LIMIT_LOAD_WORKER_ID: workerId,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    const output = createInterface({ input: this.process.stdout });
    output.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.stderr += `\nUnexpected child output: ${line}`;
        return;
      }
      const waiterIndex = this.waiters.findIndex((waiter) =>
        waiter.predicate(message),
      );
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  waitFor(predicate, timeoutMs = 30_000) {
    const existingIndex = this.messages.findIndex(predicate);
    if (existingIndex >= 0) {
      return Promise.resolve(this.messages.splice(existingIndex, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(
          new Error(
            `${this.workerId} timed out; stderr: ${this.stderr.trim() || "(empty)"}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  send(command) {
    this.process.stdin.write(`${JSON.stringify(command)}\n`);
  }

  async close() {
    if (this.process.exitCode !== null) {
      return;
    }
    this.send({ type: "close" });
    this.process.stdin.end();
    await Promise.race([
      new Promise((resolve) => this.process.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (this.process.exitCode === null) {
      this.process.kill();
    }
  }
}

const clients = [];
try {
  for (let index = 0; index < instances; index += 1) {
    clients.push(new ChildClient(`instance-${index + 1}`));
  }

  await Promise.all(
    clients.map(async (client) => {
      const ready = await client.waitFor(
        (message) =>
          message.type === "ready" || message.type === "startup-error",
        60_000,
      );
      if (ready.type === "startup-error") {
        throw new Error(`${client.workerId} failed to start: ${ready.message}`);
      }
    }),
  );

  clients[0].send({ type: "reset" });
  const reset = await clients[0].waitFor(
    (message) => message.type === "error" || message.type === "reset",
  );
  if (reset.type === "error") {
    throw new Error(reset.message);
  }

  const baseNow = Date.now() + 60_000;
  const windowMs = 60_000;
  const batchReports = [];
  const startedAt = performance.now();

  for (let round = 0; round < rounds; round += 1) {
    const batchId = `round-${round + 1}`;
    const key = `load:${baseNow}:${round + 1}`;
    const now = baseNow + round * 1_000;
    await Promise.all(
      clients.map(async (client) => {
        client.send({
          type: "consume",
          batchId,
          workerId: client.workerId,
          key,
          limit,
          windowMs,
          now,
          count: requestsPerInstance,
        });
        const result = await client.waitFor(
          (message) =>
            message.type === "error" ||
            (message.type === "result" && message.batchId === batchId),
        );
        if (result.type === "error") {
          throw new Error(`${client.workerId}: ${result.message}`);
        }
        return result;
      }),
    ).then((workerResults) => {
      const allowed = workerResults.reduce(
        (total, result) => total + result.allowed,
        0,
      );
      const attempted = workerResults.reduce(
        (total, result) => total + result.attempted,
        0,
      );
      const blocked = attempted - allowed;
      if (allowed !== limit) {
        throw new Error(
          `${batchId} allowed ${allowed} requests; expected exactly ${limit}`,
        );
      }
      batchReports.push({
        id: batchId,
        key,
        attempted,
        allowed,
        blocked,
        maxWorkerLatencyMs: Math.max(
          ...workerResults.map((result) => result.elapsedMs),
        ),
        workers: workerResults,
      });
    });

    clients[0].send({ type: "inspect", key });
    const bucket = await clients[0].waitFor(
      (message) =>
        message.type === "error" ||
        (message.type === "bucket" && message.key === key),
    );
    if (bucket.type === "error") {
      throw new Error(bucket.message);
    }
    if (bucket.count !== limit) {
      throw new Error(
        `${batchId} persisted count ${bucket.count}; expected ${limit}`,
      );
    }
  }

  const durationMs = performance.now() - startedAt;
  const report = {
    generatedAt: new Date().toISOString(),
    database: {
      dialect: "postgresql",
      connectionLimitPerProcess: 2,
    },
    configuration: {
      independentProcesses: instances,
      requestsPerProcess: requestsPerInstance,
      limit,
      windowMs,
      rounds,
    },
    totals: {
      attempts: batchReports.reduce(
        (total, batch) => total + batch.attempted,
        0,
      ),
      allowed: batchReports.reduce(
        (total, batch) => total + batch.allowed,
        0,
      ),
      blocked: batchReports.reduce(
        (total, batch) => total + batch.blocked,
        0,
      ),
      durationMs: Number(durationMs.toFixed(2)),
      throughputPerSec: Number(
        (
          batchReports.reduce((total, batch) => total + batch.attempted, 0) /
          (durationMs / 1_000)
        ).toFixed(2),
      ),
    },
    rounds: batchReports,
  };

  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const outPath = path.resolve(repoRoot, options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, rendered, "utf8");
  }
  process.stdout.write(rendered);
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
}
