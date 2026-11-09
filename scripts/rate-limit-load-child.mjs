import { createInterface } from "node:readline";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

try {
  const moduleUrl = process.env.RATE_LIMIT_LOAD_MODULE;
  if (!moduleUrl) {
    throw new Error("RATE_LIMIT_LOAD_MODULE is required");
  }
  const rateLimit = await import(moduleUrl);
  const database = rateLimit;

  const input = createInterface({ input: process.stdin });
  let closed = false;

  async function handle(command) {
    if (command.type === "consume") {
      const startedAt = performance.now();
      const results = await Promise.all(
        Array.from({ length: command.count }, () =>
          rateLimit.consumeRateLimit(
            command.key,
            command.limit,
            command.windowMs,
            command.now,
          ),
        ),
      );
      const elapsedMs = performance.now() - startedAt;
      const allowed = results.filter((result) => result.allowed);
      const blocked = results.filter((result) => !result.allowed);
      send({
        type: "result",
        batchId: command.batchId,
        workerId: command.workerId,
        attempted: results.length,
        allowed: allowed.length,
        blocked: blocked.length,
        remainingMin:
          allowed.length > 0
            ? Math.min(...allowed.map((result) => result.remaining))
            : 0,
        retryAfterSecs: [
          ...new Set(blocked.map((result) => result.retryAfterSec)),
        ].sort((left, right) => left - right),
        elapsedMs: Number(elapsedMs.toFixed(2)),
      });
      return;
    }

    if (command.type === "inspect") {
      const bucket = await database.prisma.rateLimitBucket.findUnique({
        where: { key: command.key },
      });
      send({
        type: "bucket",
        key: command.key,
        count: bucket?.count ?? 0,
        resetAt: bucket?.resetAt?.toISOString() ?? null,
      });
      return;
    }

    if (command.type === "reset") {
      await rateLimit.resetRateLimits();
      send({ type: "reset" });
      return;
    }

    if (command.type === "close") {
      closed = true;
      input.close();
      await database.prisma.$disconnect();
      return;
    }

    throw new Error(`Unknown child command: ${String(command.type)}`);
  }

  input.on("line", (line) => {
    if (closed) {
      return;
    }
    let command;
    try {
      command = JSON.parse(line);
    } catch (error) {
      send({ type: "error", message: String(error) });
      return;
    }
    void handle(command).catch((error) => {
      send({
        type: "error",
        message: error instanceof Error ? error.stack ?? error.message : String(error),
      });
    });
  });

  input.on("close", () => {
    if (!closed) {
      void database.prisma.$disconnect();
    }
  });

  send({ type: "ready", workerId: process.env.RATE_LIMIT_LOAD_WORKER_ID });
} catch (error) {
  send({
    type: "startup-error",
    message: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exitCode = 1;
}
