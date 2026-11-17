import { spawn } from "node:child_process";

const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "publish",
    "--workspace",
    "@kylosonic/opencontext-schemas",
    "--access",
    "public",
    "--provenance",
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  },
);

let pending = "";
function forward(stream, chunk) {
  stream.write(chunk);
  pending += chunk.toString();
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() ?? "";
  for (const line of lines) {
    const match = line.match(/https:\/\/www\.npmjs\.com\/auth\/cli\/[0-9a-f-]+/);
    if (match) {
      console.log(`::notice title=npm authentication::${match[0]}`);
    }
  }
}

child.stdout.on("data", (chunk) => forward(process.stdout, chunk));
child.stderr.on("data", (chunk) => forward(process.stderr, chunk));

const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
process.exitCode = exitCode ?? 1;
