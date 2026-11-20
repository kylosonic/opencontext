#!/usr/bin/env node
/** Download a small, reproducible photo/video corpus for manual smoke tests. */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const outputDir = path.resolve(process.argv[2] || ".artifacts/media-corpus");
const maxBytes = 30 * 1024 * 1024;

const assets = [
  ...Array.from({ length: 8 }, (_, index) => ({
    name: `photo-${String(index + 1).padStart(2, "0")}.jpg`,
    url: `https://picsum.photos/seed/opencontext-photo-${index + 1}/960/720.jpg`,
    kind: "image",
    source: "Lorem Picsum (Unsplash-backed placeholder photography)",
    license: "Downloaded for local integration testing; not redistributed by the repository",
  })),
  {
    name: "cc0-grapefruit.jpg",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-images/grapefruit-slice-332-332.jpg",
    kind: "image",
    source: "MDN Web Docs interactive examples",
    license: "CC0-1.0",
  },
  {
    name: "cc0-flower.mp4",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    kind: "video",
    source: "MDN Web Docs interactive examples",
    license: "CC0-1.0",
  },
  {
    name: "sintel-trailer.mp4",
    url: "https://media.w3.org/2010/05/sintel/trailer.mp4",
    kind: "video",
    source: "W3C HTML media examples; Sintel trailer",
    license: "Sintel is licensed CC BY 3.0; see https://durian.blender.org/sharing/",
  },
];

async function download(asset) {
  const response = await fetch(asset.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
    headers: { "user-agent": "opencontext-media-smoke/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${asset.name}: HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > maxBytes) {
    throw new Error(`${asset.name}: declared size ${declared} exceeds ${maxBytes}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`${asset.name}: downloaded size ${bytes.length} is invalid`);
  }
  const destination = path.join(outputDir, asset.name);
  await writeFile(destination, bytes);
  return {
    ...asset,
    fileName: asset.name,
    bytes: bytes.length,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

await mkdir(outputDir, { recursive: true });
const downloaded = [];
for (const asset of assets) {
  try {
    const result = await download(asset);
    downloaded.push(result);
    console.log(`downloaded ${result.fileName} (${result.bytes} bytes)`);
  } catch (error) {
    // The MDN source occasionally has an outage; retain other assets so the
    // smoke suite can still exercise every locally available format.
    console.error(`warning: ${asset.name}: ${error instanceof Error ? error.message : error}`);
  }
}

const jpeg = path.join(outputDir, "photo-01.jpg");
try {
  await readFile(jpeg);
  const pngName = "photo-09.png";
  const webpName = "photo-10.webp";
  await sharp(jpeg).png().toFile(path.join(outputDir, pngName));
  await sharp(jpeg).webp({ quality: 85 }).toFile(path.join(outputDir, webpName));
  for (const fileName of [pngName, webpName]) {
    const bytes = await readFile(path.join(outputDir, fileName));
    downloaded.push({
      name: fileName,
      fileName,
      kind: "image",
      source: "Derived from photo-01.jpg",
      license: "Same source license as photo-01.jpg",
      bytes: bytes.length,
      contentType: fileName.endsWith(".png") ? "image/png" : "image/webp",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
} catch (error) {
  console.error(`warning: could not create PNG/WebP variants: ${error}`);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  outputDir,
  assets: downloaded,
};
await writeFile(
  path.join(outputDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(`wrote ${path.join(outputDir, "manifest.json")} (${downloaded.length} assets)`);

