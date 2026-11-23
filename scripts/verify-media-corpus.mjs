#!/usr/bin/env node
/** Verify and replay every downloaded corpus asset with credential-free providers. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const corpusDir = path.resolve(process.argv[2] || ".artifacts/media-corpus");
const outputDir = path.resolve(
  process.env.OPENCONTEXT_CORPUS_OUTPUT || ".artifacts/media-corpus-current",
);
const configuredCli = process.env.OPENCONTEXT_CLI?.trim();
const cli = configuredCli
  ? configuredCli.includes(path.sep)
    ? path.resolve(configuredCli)
    : configuredCli
  : path.join(repoRoot, "workers/processor/.venv/bin/opencontext");

const manifest = JSON.parse(
  await readFile(path.join(corpusDir, "manifest.json"), "utf8"),
);
assert.ok(Array.isArray(manifest.assets) && manifest.assets.length >= 2);
assert.ok(
  manifest.assets.some((asset) => asset.kind === "image"),
  "media corpus contains no images",
);
assert.ok(
  manifest.assets.some((asset) => asset.kind === "video"),
  "media corpus contains no videos",
);
await mkdir(outputDir, { recursive: true });

function run(args, timeout = 300_000) {
  const result = spawnSync(cli, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCONTEXT_SKIP_DOTENV: "1",
      TRANSCRIPTION_PROVIDER: "fixture",
      VISION_PROVIDER: "fixture",
      OCR_PROVIDER: "vision",
      TEXT_PROVIDER: "template",
    },
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${cli} ${args.join(" ")}\n${result.stderr}`,
    );
  }
}

const verified = [];
for (const [assetIndex, asset] of manifest.assets.entries()) {
  const source = path.join(corpusDir, asset.fileName);
  const bytes = await readFile(source);
  assert.equal(bytes.length, asset.bytes, `${asset.fileName} size changed`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    asset.sha256,
    `${asset.fileName} hash changed`,
  );

  const stem = path.basename(asset.fileName, path.extname(asset.fileName));
  const assetDir = path.join(
    outputDir,
    `${String(assetIndex + 1).padStart(3, "0")}-${stem}`,
  );
  await mkdir(assetDir, { recursive: true });
  const markdown = path.join(assetDir, "context.md");
  const json = path.join(assetDir, "context.json");
  const brief = path.join(assetDir, "brief.md");
  const report = path.join(assetDir, "replay.json");

  run([
    "analyze",
    source,
    "--offline",
    "--detail-level",
    "MEDIUM",
    "--out",
    markdown,
    "--json",
    json,
  ]);
  const payload = JSON.parse(await readFile(json, "utf8"));
  assert.ok(Array.isArray(payload.evidence) && payload.evidence.length > 0);
  assert.match(await readFile(markdown, "utf8"), /E\d{4}/);

  run([
    "replay",
    json,
    "--repo",
    process.cwd(),
    "--task",
    `Validate the downloaded ${asset.kind} ${asset.fileName}.`,
    "--out",
    brief,
    "--report",
    report,
  ]);
  const replay = JSON.parse(await readFile(report, "utf8"));
  assert.equal(replay.ok, true);
  assert.ok(replay.counts.evidence > 0);

  verified.push({
    fileName: asset.fileName,
    kind: asset.kind,
    bytes: asset.bytes,
    sha256: asset.sha256,
    evidence: payload.evidence.length,
    markdown,
    json,
    replay: report,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  corpusDir,
  outputDir,
  assets: verified,
  counts: {
    images: verified.filter((item) => item.kind === "image").length,
    videos: verified.filter((item) => item.kind === "video").length,
  },
};
await writeFile(
  path.join(outputDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
console.log(
  `verified ${summary.counts.images} images and ${summary.counts.videos} videos: ${path.join(outputDir, "summary.json")}`,
);
