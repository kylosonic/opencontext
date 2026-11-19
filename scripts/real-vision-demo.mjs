import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const composeFile = path.join(repoRoot, "docker-compose.yml");
const args = process.argv.slice(2);
const dockerArgs = args[0] === "--" ? args.slice(1) : args;
let mode =
  process.env.OPENCONTEXT_DEMO_VISION ||
  (process.env.OPENAI_API_KEY ? "real" : "");
let explicitMode = Boolean(mode);
if (dockerArgs[0] === "real") {
  mode = "real";
  explicitMode = true;
  dockerArgs.shift();
}

function fail(message) {
  console.error(`real-vision-demo: ${message}`);
  process.exit(1);
}

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function envFileArgs() {
  const local = path.join(repoRoot, ".env.local");
  return existsSync(local) ? ["--env-file", local] : [];
}

function runDocker(values, selectedArgs = dockerArgs) {
  const command = ["compose", "-f", composeFile, ...envFileArgs()];
  command.push(...(selectedArgs.length === 0 ? ["up", "--build"] : selectedArgs));
  const result = spawnSync("docker", command, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      OPENCODE_API_KEY: "",
      ...values,
    },
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function checkConfiguration(values) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      ...envFileArgs(),
      "run",
      "--rm",
      "--no-deps",
      "worker",
      "python",
      "-m",
      "oc_worker.main",
      "--check-demo-vision",
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        OPENCODE_API_KEY: "",
        ...values,
      },
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail("AI provider configuration is incomplete; no provider request was made");
  }
}

if (!new Set(["fixture", "real"]).has(mode)) {
  fail("OPENCONTEXT_DEMO_VISION must be fixture or real");
}

const fixtureValues = {
  OPENCONTEXT_DEMO_VISION: "fixture",
  TRANSCRIPTION_PROVIDER: "none",
  VISION_PROVIDER: "fixture",
  TEXT_PROVIDER: "template",
};
if (!explicitMode && dockerArgs.length === 0) {
  console.error("real-vision-demo: real settings are incomplete; starting fixture mode");
  process.exit(runDocker(fixtureValues));
}
if (mode !== "real") {
  checkConfiguration(fixtureValues);
  const upArgs = dockerArgs[0] === "up" ? dockerArgs : ["up", "--build"];
  process.exit(runDocker(fixtureValues, upArgs));
}

const missing = ["OPENCONTEXT_DEMO_MODEL", "OPENAI_BASE_URL"].filter(
  (name) => !present(name),
);
const apiKey = process.env.OPENAI_API_KEY || process.env.OPENCODE_API_KEY;
if (!apiKey) {
  missing.push("OPENAI_API_KEY or OPENCODE_API_KEY");
}
if (missing.length > 0) {
  fail(`real mode requires ${missing.join(", ")}; no provider call was made`);
}

const realValues = {
  OPENCONTEXT_DEMO_VISION: "real",
  OPENCONTEXT_DEMO_MODEL: process.env.OPENCONTEXT_DEMO_MODEL,
  OPENCONTEXT_DEMO_OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  ...(process.env.OPENAI_API_KEY
    ? { OPENCONTEXT_DEMO_OPENAI_API_KEY: process.env.OPENAI_API_KEY }
    : { OPENCONTEXT_DEMO_OPENCODE_API_KEY: process.env.OPENCODE_API_KEY }),
  VISION_PROVIDER: "openai_compatible",
  TRANSCRIPTION_PROVIDER: "none",
  TEXT_PROVIDER: "openai_compatible",
};
checkConfiguration(realValues);
const upArgs = dockerArgs[0] === "up" ? dockerArgs : ["up", "--build"];
process.exit(runDocker(realValues, upArgs));
