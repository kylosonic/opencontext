#!/usr/bin/env node
/** Run the downloaded held-out corpus through OpenContext and score each item. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const corpusDir = path.resolve(process.argv[2] || ".artifacts/heldout-evaluation");
const outputDir = path.resolve(process.env.OPENCONTEXT_HELDOUT_OUTPUT || ".artifacts/heldout-results");
const manifest = JSON.parse(await readFile(path.join(corpusDir, "manifest.json"), "utf8"));
const configuredCli = process.env.OPENCONTEXT_CLI?.trim();
const cli = configuredCli
  ? configuredCli.includes(path.sep)
    ? path.resolve(configuredCli)
    : configuredCli
  : path.join(
      repoRoot,
      "workers",
      "processor",
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "opencontext.exe" : "opencontext",
    );
const transcriptionProvider = process.env.HELDOUT_TRANSCRIPTION_PROVIDER || "faster_whisper";
const transcriptionModel = process.env.HELDOUT_TRANSCRIPTION_MODEL || "tiny.en";
const visionProvider = process.env.HELDOUT_VISION_PROVIDER || "fixture";
const visionModel = process.env.HELDOUT_VISION_MODEL || "fixture";
const ocrProvider = process.env.HELDOUT_OCR_PROVIDER || "vision";
const bothFixture = visionProvider === "fixture" && transcriptionProvider === "fixture";
const bothMeasured = visionProvider !== "fixture" && transcriptionProvider !== "fixture";
const measurementKind = process.env.HELDOUT_MEASUREMENT_KIND ||
  (bothFixture ? "fixture-baseline" : bothMeasured ? "measured" : "mixed");

await mkdir(outputDir, { recursive: true });

function run(args, env = {}, timeout = 600_000) {
  const result = spawnSync(cli, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCONTEXT_SKIP_DOTENV: "1",
      VISION_PROVIDER: visionProvider,
      VISION_MODEL: visionModel,
      // Still-image jobs have no audio. Keep their unrelated transcription
      // provider deterministic even when the shell has a hosted default.
      TRANSCRIPTION_PROVIDER: "fixture",
      OCR_PROVIDER: ocrProvider,
      TEXT_PROVIDER: "template",
      ...env,
    },
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${cli} ${args.join(" ")}\n${result.stderr}`);
  }
}

function truthEnvelope(dataset, provenance, license, item) {
  return { datasetId: dataset, provenance, license, item: { ...item, datasetId: dataset, provenance, license } };
}

function mean(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : null;
}

async function analyzeOne({ id, source, truth, model, provider, itemMeasurementKind, extraEnv = {} }) {
  const itemDir = path.join(outputDir, id);
  await mkdir(itemDir, { recursive: true });
  const contextPath = path.join(itemDir, "context.json");
  const markdownPath = path.join(itemDir, "context.md");
  const truthPath = path.join(itemDir, "truth.json");
  const scorePath = path.join(itemDir, "score.json");
  await writeFile(truthPath, `${JSON.stringify(truth, null, 2)}\n`, "utf8");
  run(["analyze", path.join(corpusDir, source), "--detail-level", "MEDIUM", "--out", markdownPath, "--json", contextPath], extraEnv);
  run([
    "evaluate", contextPath,
    "--truth", truthPath,
    "--model-name", provider,
    "--model-version", model,
    "--measurement-kind", itemMeasurementKind,
    "--out", scorePath,
  ], extraEnv);
  return JSON.parse(await readFile(scorePath, "utf8"));
}

const audioTruth = truthEnvelope(
  manifest.audio.id,
  manifest.audio.provenance,
  manifest.audio.license,
  {
    id: "ami-noisy-conversation",
    sourceName: manifest.audio.source,
    transcript: manifest.audio.transcript,
    ocrTexts: [],
    visualKeywords: [],
  },
);
const audioScore = await analyzeOne({
  id: "ami-noisy-conversation",
  source: manifest.audio.source,
  truth: audioTruth,
  model: transcriptionModel,
  provider: transcriptionProvider,
  itemMeasurementKind: transcriptionProvider === "fixture" ? "fixture-baseline" : "measured",
  extraEnv: {
    TRANSCRIPTION_PROVIDER: transcriptionProvider,
    TRANSCRIPTION_MODEL: transcriptionModel,
  },
});

const visualScores = [];
for (const [index, item] of manifest.visual.items.entries()) {
  const truth = truthEnvelope(
    manifest.visual.id,
    item.provenance,
    item.license,
    {
      id: item.id,
      sourceName: item.source,
      transcript: "",
      ocrTexts: item.ocrTexts,
      visualKeywords: item.visualKeywords,
    },
  );
  const score = await analyzeOne({
    id: `${String(index + 1).padStart(2, "0")}-${item.id}`,
    source: item.source,
    truth,
    model: visionModel,
    provider: visionProvider,
    itemMeasurementKind: visionProvider === "fixture" ? "fixture-baseline" : "measured",
  });
  visualScores.push(score);
  console.log(`scored ${item.id}: OCR F1 ${score.ocr.f1}, visual recall ${score.visual.recall}`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  measurementKind,
  corpus: { audio: manifest.audio.id, visual: manifest.visual.id },
  models: {
    transcription: { provider: transcriptionProvider, model: transcriptionModel },
    vision: { provider: visionProvider, model: visionModel },
    ocr: { provider: ocrProvider },
  },
  audio: {
    items: 1,
    clips: manifest.audio.clips.length,
    wordErrorRate: audioScore.transcript.wordErrorRate,
    characterErrorRate: audioScore.transcript.characterErrorRate,
    score: audioScore,
  },
  visual: {
    items: visualScores.length,
    ocrPrecision: mean(visualScores.map((score) => score.ocr.precision)),
    ocrRecall: mean(visualScores.map((score) => score.ocr.recall)),
    ocrF1: mean(visualScores.map((score) => score.ocr.f1)),
    visualRecall: mean(visualScores.map((score) => score.visual.recall)),
    score: visualScores,
  },
  limitations: [
    "AMI SDM utterance clips are concatenated to exercise conversational far-field speech; this is not a full meeting benchmark.",
    "Screen2Words labels differ from free-form OpenContext captions, so OCR set metrics and caption keyword recall are proxy measures.",
    "Fixture-provider results are plumbing baselines and must never be presented as model quality.",
  ],
};
await writeFile(
  path.join(outputDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(`wrote ${path.join(outputDir, "summary.json")}`);
