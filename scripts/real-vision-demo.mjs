import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import {
  parseDemoInvocation,
  selectDemoProvider,
} from "./real-vision-demo-config.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const composeFile = path.join(repoRoot, "docker-compose.yml");
const localEnvFile = path.join(repoRoot, ".env.local");
if (existsSync(localEnvFile)) {
  loadEnv({ path: localEnvFile, override: false, quiet: true });
}
const args = process.argv.slice(2);
const { dockerArgs, mode, explicitMode } = parseDemoInvocation(
  process.env,
  args,
);

function fail(message) {
  console.error(`real-vision-demo: ${message}`);
  process.exit(1);
}

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function envFileArgs() {
  return existsSync(localEnvFile) ? ["--env-file", localEnvFile] : [];
}

const sanitizedProviderEnvironment = {
  OPENAI_API_KEY: "",
  OPENCODE_API_KEY: "",
  OPENCONTEXT_DEMO_OPENAI_API_KEY: "",
  OPENCONTEXT_DEMO_OPENCODE_API_KEY: "",
  GEMINI_API_KEY: "",
};

function runDocker(values, selectedArgs = dockerArgs) {
  const command = ["compose", "-f", composeFile, ...envFileArgs()];
  command.push(...(selectedArgs.length === 0 ? ["up", "--build"] : selectedArgs));
  const result = spawnSync("docker", command, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...sanitizedProviderEnvironment,
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
        ...sanitizedProviderEnvironment,
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

// Preserve normal Compose lifecycle commands verbatim (down, logs, config,
// stop, and so on). Mode configuration applies only to an implicit/up run.
if (!explicitMode && dockerArgs.length > 0) {
  process.exit(runDocker({}));
}

if (!new Set(["fixture", "real"]).has(mode)) {
  fail("OPENCONTEXT_DEMO_VISION must be fixture or real");
}

const fixtureValues = {
  OPENCONTEXT_DEMO_VISION: "fixture",
  OPENCONTEXT_TRANSCRIPTION_PROVIDER: "none",
  VISION_PROVIDER: "fixture",
  TEXT_PROVIDER: "template",
};
if (mode !== "real") {
  checkConfiguration(fixtureValues);
  const upArgs = dockerArgs[0] === "up" ? dockerArgs : ["up", "--build"];
  process.exit(runDocker(fixtureValues, upArgs));
}

const {
  useGemini,
  useOpenAI,
  useOpenCode,
  geminiApiKey,
  openaiApiKey,
  opencodeApiKey,
  geminiModel,
  openaiBaseUrl,
} = selectDemoProvider(process.env);
const missing = [
  ...(useGemini ? [] : ["OPENCONTEXT_DEMO_MODEL"]),
].filter(
  (name) => !present(name),
);
if (!useGemini && !useOpenAI && !useOpenCode) {
  missing.push("GEMINI_API_KEY, OPENAI_API_KEY, or OPENCODE_API_KEY");
}
if (missing.length > 0) {
  fail(`real mode requires ${missing.join(", ")}; no provider call was made`);
}

const realValues = {
  OPENCONTEXT_DEMO_VISION: "real",
  OPENCONTEXT_DEMO_MODEL: useGemini
    ? geminiModel
    : process.env.OPENCONTEXT_DEMO_MODEL,
  ...(useGemini
    ? {
        GEMINI_API_KEY: geminiApiKey,
        GEMINI_BASE_URL:
          process.env.GEMINI_BASE_URL ||
          "https://generativelanguage.googleapis.com/v1beta",
        VISION_PROVIDER: "gemini",
      }
    : {
        OPENCONTEXT_DEMO_OPENAI_BASE_URL:
          openaiBaseUrl,
        ...(useOpenAI
          ? { OPENCONTEXT_DEMO_OPENAI_API_KEY: openaiApiKey }
          : { OPENCONTEXT_DEMO_OPENCODE_API_KEY: opencodeApiKey }),
        VISION_PROVIDER: "openai_compatible",
      }),
  OPENCONTEXT_TRANSCRIPTION_PROVIDER: "none",
  TEXT_PROVIDER: useGemini ? "template" : "openai_compatible",
};
checkConfiguration(realValues);
const upArgs = dockerArgs[0] === "up" ? dockerArgs : ["up", "--build"];
process.exit(runDocker(realValues, upArgs));
