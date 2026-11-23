import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDemoInvocation,
  selectDemoProvider,
} from "./real-vision-demo-config.mjs";

test("Compose lifecycle commands bypass demo mode configuration", () => {
  const invocation = parseDemoInvocation(
    { OPENAI_API_KEY: "sk-test" },
    ["down"],
  );
  assert.equal(invocation.mode, "fixture");
  assert.equal(invocation.explicitMode, false);
  assert.deepEqual(invocation.dockerArgs, ["down"]);
});

test("explicit environment and positional modes are tracked", () => {
  assert.equal(
    parseDemoInvocation(
      { OPENCONTEXT_DEMO_VISION: "real" },
      [],
    ).explicitMode,
    true,
  );
  const positional = parseDemoInvocation({}, ["fixture", "logs"]);
  assert.equal(positional.mode, "fixture");
  assert.equal(positional.explicitMode, true);
  assert.deepEqual(positional.dockerArgs, ["logs"]);
});

test("OPENAI_API_KEY defaults to OpenAI, while OpenCode keys use OpenCode", () => {
  const openai = selectDemoProvider({ OPENAI_API_KEY: "sk-test" });
  assert.equal(openai.openaiBaseUrl, "https://api.openai.com/v1");
  assert.equal(openai.useOpenAI, true);
  assert.equal(openai.useOpenCode, false);

  const opencode = selectDemoProvider({ OPENCODE_API_KEY: "opencode-test" });
  assert.equal(
    opencode.openaiBaseUrl,
    "https://opencode.ai/inference/go/openai/v1",
  );
  assert.equal(opencode.useOpenCode, true);
});
