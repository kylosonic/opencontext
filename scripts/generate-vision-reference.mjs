import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findFfmpeg } from "./ffmpeg-command.mjs";

const repository = path.resolve(import.meta.dirname, "..");
const output = path.join(repository, "docs/assets/real-vision-checkout.png");
await mkdir(path.dirname(output), { recursive: true });

const result = spawnSync(
  findFfmpeg(),
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xF8FAFC:s=960x640:r=1:d=1",
    "-vf",
    [
      "drawbox=x=90:y=60:w=780:h=520:color=white:t=fill",
      "drawbox=x=90:y=60:w=780:h=520:color=0x94A3B8:t=3",
      "drawtext=text='Checkout':fontsize=42:fontcolor=0x0F172A:x=130:y=95",
      "drawtext=text='Order 1042':fontsize=28:fontcolor=0x334155:x=130:y=190",
      "drawtext=text='Total $42.00':fontsize=28:fontcolor=0x334155:x=130:y=250",
      "drawbox=x=130:y=350:w=260:h=65:color=0x2563EB:t=fill",
      "drawtext=text='Pay now':fontsize=28:fontcolor=white:x=190:y=368",
      "drawtext=text='Visa ending 4242':fontsize=24:fontcolor=0x64748B:x=130:y=500",
    ].join(","),
    "-frames:v",
    "1",
    output,
  ],
  { stdio: "inherit" },
);
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
