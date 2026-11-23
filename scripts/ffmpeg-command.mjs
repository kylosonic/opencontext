import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function candidates() {
  const values = [process.env.OPENCONTEXT_FFMPEG, process.env.FFMPEG_PATH];
  const pythonCandidates = [
    process.env.OPENCONTEXT_PYTHON,
    path.join(
      repoRoot,
      "workers",
      "processor",
      ".venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    ),
    process.platform === "win32" ? "python" : "python3",
  ];
  for (const python of pythonCandidates.filter(Boolean)) {
    if (path.isAbsolute(python) && !existsSync(python)) continue;
    try {
      values.push(
        execFileSync(
          python,
          ["-c", "from imageio_ffmpeg import get_ffmpeg_exe; print(get_ffmpeg_exe())"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 },
        ).trim(),
      );
    } catch {
      // Try the next interpreter.
    }
  }
  values.push("ffmpeg");
  return [...new Set(values.filter(Boolean))];
}

/** Return an FFmpeg binary with the encoders used by repository fixtures. */
export function findFfmpeg() {
  for (const candidate of candidates()) {
    try {
      const encoders = execFileSync(candidate, ["-hide_banner", "-encoders"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      });
      if (encoders.includes("libx264")) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("FFmpeg with libx264 is required; install imageio-ffmpeg or set FFMPEG_PATH");
}
