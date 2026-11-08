import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../../../..");
const workerSrc = path.join(repoRoot, "workers", "processor", "src");

function candidates(): string[] {
  const configured = process.env.OPENCONTEXT_PYTHON;
  const onWindows = process.platform === "win32";
  return [
    ...(configured ? [configured] : []),
    path.join(
      repoRoot,
      "workers",
      "processor",
      ".venv",
      onWindows ? "Scripts" : "bin",
      onWindows ? "python.exe" : "python",
    ),
    onWindows ? "python" : "python3",
    "python",
  ];
}

export function findWorkerPython(): string | null {
  for (const candidate of candidates()) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) {
      continue;
    }
    try {
      execFileSync(candidate, ["-c", "import sys"], {
        stdio: "ignore",
        timeout: 5_000,
      });
      return candidate;
    } catch {
      // Try the next interpreter.
    }
  }
  return null;
}

export function workerPythonEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const existing = process.env.PYTHONPATH;
  const tempRoot = path.join(repoRoot, ".tmp", "node-tests");
  mkdirSync(tempRoot, { recursive: true });
  return {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV,
    PYTHONPATH: existing ? `${workerSrc}${path.delimiter}${existing}` : workerSrc,
    OPENCONTEXT_TMPDIR: tempRoot,
    TMPDIR: tempRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
    ...extra,
  };
}

export const REPO_ROOT = repoRoot;
