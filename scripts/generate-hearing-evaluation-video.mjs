import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, ".artifacts");
const audio = path.join(repoRoot, "docs", "evaluation", "harvard-osr-us-10.wav");
const output = path.join(outputDir, "opencontext-hearing-eval-v1.mp4");

await mkdir(outputDir, { recursive: true });

const result = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x1d4ed8:s=960x540:r=30:d=34",
    "-i",
    audio,
    "-vf",
    "drawtext=text='OpenContext hearing evaluation':fontcolor=white:fontsize=48:borderw=1:bordercolor=black@0.16:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    output,
  ],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const bytes = await readFile(output);
console.log(output);
console.log(`sha256=${createHash("sha256").update(bytes).digest("hex")}`);
