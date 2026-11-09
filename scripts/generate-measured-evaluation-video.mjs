import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, ".artifacts");
const output = path.join(outputDir, "opencontext-measured-eval-v1.mp4");

await mkdir(outputDir, { recursive: true });

const titleFont =
  "fontcolor=white:fontsize=52:borderw=1:bordercolor=black@0.16";
const darkText = "fontcolor=0x0f172a";
const filters = [
  `[0:v]drawtext=text='Welcome to Dashboard':${titleFont}:x=(w-text_w)/2:y=(h-text_h)/2[scene0]`,
  `[1:v]drawtext=text='Settings':${darkText}:fontsize=52:x=(w-text_w)/2:y=130,drawbox=x=330:y=280:w=300:h=84:color=0x2563eb:t=fill,drawtext=text='Save Changes':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=304[scene1]`,
  "[2:v]drawbox=x=425:y=105:w=110:h=110:color=white@0.16:t=fill,drawtext=text='Saved Successfully':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=(h-text_h)/2[scene2]",
  "[scene0][scene1][scene2]concat=n=3:v=1:a=0,format=yuv420p[outv]",
].join(";");

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
    "color=c=0x2563eb:s=960x540:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xf8fafc:s=960x540:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x15803d:s=960x540:r=30:d=2",
    "-filter_complex",
    filters,
    "-map",
    "[outv]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryslow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
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
