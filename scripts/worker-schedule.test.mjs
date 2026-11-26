import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("GitHub worker relay stays free and continuously staffed on schedule", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/worker-schedule.yml"),
    "utf8",
  );

  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(
    workflow,
    /repository_dispatch:\s+types: \[job-queued\]/,
  );
  assert.match(
    workflow,
    /group: opencontext-worker\s+cancel-in-progress: false/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /cache: pip/);
  assert.match(workflow, /cache-dependency-path: workers\/processor\/pyproject\.toml/);
  assert.match(workflow, /ALLOW_PRIVATE_ACTIONS_MINUTES/);
  assert.match(workflow, /visibility.*!=.*public/);
  assert.match(workflow, /CONTINUOUS_RELAY:.*github\.event_name != 'workflow_dispatch'/);
  assert.match(
    workflow,
    /if \[ "\$CONTINUOUS_RELAY" = "1" \]; then\s+python -m oc_worker\.main --drain-seconds 900\s+else\s+python -m oc_worker\.main --drain-seconds 900 --exit-on-idle/s,
  );
});

test("Render worker blueprint keeps the persistent drain contract", async () => {
  const blueprint = yaml.load(
    await readFile(path.join(root, "render.yaml"), "utf8"),
  );
  assert.ok(blueprint && typeof blueprint === "object");
  assert.ok(Array.isArray(blueprint.services));

  const worker = blueprint.services.find(
    (service) => service?.name === "opencontext-worker",
  );
  assert.ok(worker);
  assert.equal(worker.type, "worker");
  assert.equal(worker.runtime, "docker");
  assert.equal(worker.dockerfilePath, "./docker/worker-hosted.Dockerfile");
  assert.equal(worker.maxShutdownDelaySeconds, 180);
  assert.equal(worker.disk?.mountPath, "/models");

  const envKeys = new Set(worker.envVars?.map((entry) => entry.key));
  for (const key of [
    "WORKER_API_URL",
    "WORKER_API_TOKEN",
    "OPENAI_API_KEY",
    "WORKER_JOB_TIMEOUT_SECONDS",
  ]) {
    assert.ok(envKeys.has(key), `render.yaml is missing ${key}`);
  }
});
