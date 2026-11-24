#!/usr/bin/env node
/** Download a deterministic, licensed held-out corpus without committing media. */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg-command.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const spec = JSON.parse(
  await readFile(path.join(repoRoot, "docs/evaluation/heldout-datasets.json"), "utf8"),
);
const outputDir = path.resolve(process.argv[2] || ".artifacts/heldout-evaluation");
const maxBytes = 30 * 1024 * 1024;
const datasetEndpoint = "https://datasets-server.huggingface.co/rows";

async function fetchBytes(url, label) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "opencontext-heldout-evaluation/1.0" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`${label}: declared file is too large`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`${label}: downloaded size is invalid`);
  }
  return { bytes, contentType: response.headers.get("content-type") || "" };
}

async function datasetRow(dataset, config, split, offset) {
  // The public dataset API applies a modest per-address request budget. A
  // small delay keeps a 48-row corpus reproducible without tripping it.
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  const url = new URL(datasetEndpoint);
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", config);
  url.searchParams.set("split", split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", "1");
  let response;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetch(url, {
      headers: { "user-agent": "opencontext-heldout-evaluation/1.0" },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) break;
    if (response.status !== 429 && response.status < 500) break;
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const delayMs = Math.max(retryAfter * 1000, 1_000 * 2 ** attempt);
    console.warn(`${dataset} row ${offset}: HTTP ${response.status}; retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (!response?.ok) {
    throw new Error(`${dataset} row ${offset}: HTTP ${response?.status ?? "unknown"}`);
  }
  const payload = await response.json();
  const row = payload?.rows?.[0]?.row;
  if (!row) throw new Error(`${dataset} row ${offset}: missing row`);
  return row;
}

function rowOffsets(section) {
  const last = section.totalRows - 1;
  return Array.from({ length: section.count }, (_, index) =>
    Math.min(last, index * section.stride),
  );
}

function textValues(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) textValues(entry, result);
  } else if (value && typeof value === "object") {
    if (typeof value.text === "string" && value.text.trim()) result.push(value.text.trim());
    for (const entry of Object.values(value)) textValues(entry, result);
  }
  return result;
}

function visualKeywords(captions) {
  const stop = new Set([
    "app", "application", "page", "screen", "showing", "display", "displaying",
    "with", "from", "this", "that", "the", "and", "for", "mobile", "phone",
    "view", "user", "interface", "ui",
  ]);
  const words = captions
    .join(" ")
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{3,}/g) || [];
  return [...new Set(words.filter((word) => !stop.has(word)))].slice(0, 6);
}

async function downloadAudio() {
  const section = spec.audio;
  const clipsDir = path.join(outputDir, "audio", "clips");
  await mkdir(clipsDir, { recursive: true });
  const clips = [];
  for (const [index, offset] of rowOffsets(section).entries()) {
    const row = await datasetRow(section.dataset, section.config, section.split, offset);
    const audio = row.audio?.[0];
    if (!audio?.src) throw new Error(`AMI row ${offset}: missing audio`);
    const label = `ami-${index + 1}.wav`;
    const { bytes } = await fetchBytes(audio.src, label);
    const file = path.join(clipsDir, label);
    await writeFile(file, bytes);
    clips.push({
      rowIndex: offset,
      audioId: row.audio_id,
      speakerId: row.speaker_id,
      meetingId: row.meeting_id,
      text: row.text,
      file: path.relative(outputDir, file).split(path.sep).join("/"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    console.log(`downloaded AMI row ${offset} (${bytes.length} bytes)`);
  }

  const listFile = path.join(outputDir, "audio", "concat.txt");
  await writeFile(
    listFile,
    clips.map((clip) => `file '${path.join(outputDir, clip.file).replaceAll("'", "'\\''")}'`).join("\n") + "\n",
  );
  const combined = path.join(outputDir, "audio", "ami-noisy-conversation.wav");
  const ffmpeg = findFfmpeg();
  const result = spawnSync(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", combined],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.status !== 0) throw new Error(`FFmpeg concat failed: ${result.stderr}`);
  const combinedBytes = await readFile(combined);
  return {
    id: section.id,
    dataset: section.dataset,
    provenance: section.provenance,
    license: section.license,
    citation: section.citation,
    source: path.relative(outputDir, combined).split(path.sep).join("/"),
    bytes: combinedBytes.length,
    sha256: createHash("sha256").update(combinedBytes).digest("hex"),
    transcript: clips.map((clip) => clip.text).join(" "),
    clips,
  };
}

async function downloadVisual() {
  const section = spec.visual;
  const imagesDir = path.join(outputDir, "visual", "images");
  await mkdir(imagesDir, { recursive: true });
  const items = [];
  for (const [index, offset] of rowOffsets(section).entries()) {
    const row = await datasetRow(section.dataset, section.config, section.split, offset);
    if (!row.image?.src) throw new Error(`Screen2Words row ${offset}: missing image`);
    const label = `screen-${String(index + 1).padStart(2, "0")}-${row.screenId}.jpg`;
    const { bytes } = await fetchBytes(row.image.src, label);
    const file = path.join(imagesDir, label);
    await writeFile(file, bytes);
    let semantic = {};
    try {
      semantic = JSON.parse(row.semantic_annotations || "{}");
    } catch {
      semantic = {};
    }
    const ocrTexts = [...new Set(textValues(semantic))].slice(0, 40);
    const captions = Array.isArray(row.captions) ? row.captions : [String(row.captions || "")];
    items.push({
      id: `screen2words-${row.screenId}`,
      rowIndex: offset,
      screenId: row.screenId,
      app: row.play_store_name,
      category: row.category,
      captions,
      ocrTexts,
      visualKeywords: visualKeywords(captions),
      source: path.relative(outputDir, file).split(path.sep).join("/"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      provenance: `${section.provenance} Screen ${row.screenId}; ${row.play_store_name}.`,
      license: section.license,
    });
    console.log(`downloaded Screen2Words row ${offset} (${bytes.length} bytes)`);
  }
  return {
    id: section.id,
    dataset: section.dataset,
    provenance: section.provenance,
    license: section.license,
    citation: section.citation,
    items,
  };
}

if (process.argv.includes("--clean")) {
  await rm(outputDir, { recursive: true, force: true });
}
await mkdir(outputDir, { recursive: true });
// The public datasets server rate-limits concurrent row access. Serialize the
// two families; individual row requests also retry 429/5xx with backoff.
const audio = await downloadAudio();
const visual = await downloadVisual();
const manifest = {
  generatedAt: new Date().toISOString(),
  specVersion: spec.version,
  audio,
  visual,
  counts: { audioClips: audio.clips.length, visualImages: visual.items.length },
};
await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(`wrote ${path.join(outputDir, "manifest.json")} (${audio.clips.length} audio clips, ${visual.items.length} images)`);
