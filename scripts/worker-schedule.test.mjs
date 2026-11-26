import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("GitHub worker relay stays free and continuously staffed on schedule", async () => {
  const workflow = await readFile(
    path.join(root, ".github/workflows/worker-schedule.yml"),
    "utf8",
  );

  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /cache: pip/);
  assert.match(workflow, /cache-dependency-path: workers\/processor\/pyproject\.toml/);
  assert.match(workflow, /ALLOW_PRIVATE_ACTIONS_MINUTES/);
  assert.match(workflow, /visibility.*!=.*public/);
  assert.match(workflow, /CONTINUOUS_RELAY:.*github\.event_name == 'schedule'/);
  assert.match(
    workflow,
    /if \[ "\$CONTINUOUS_RELAY" = "1" \]; then\s+python -m oc_worker\.main --drain-seconds 900\s+else\s+python -m oc_worker\.main --drain-seconds 900 --exit-on-idle/s,
  );
});
