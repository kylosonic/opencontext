import { spawn } from "node:child_process";

process.env.BROWSER = "true";
const command =
  "npm publish --workspace @kylosonic/opencontext-schemas --access public --provenance";
const child = spawn("script", ["-qefc", command, "/dev/null"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let pending = "";
function forward(stream, chunk) {
  stream.write(chunk);
  pending += chunk.toString();
  const match = pending.match(/https:\/\/www\.npmjs\.com\/auth\/cli\/[0-9a-f-]+/);
  if (match && !globalThis.announced) {
    globalThis.announced = true;
    console.log(`::notice title=npm authentication::${match[0]}`);
  }
}

child.stdout.on("data", (chunk) => forward(process.stdout, chunk));
child.stderr.on("data", (chunk) => forward(process.stderr, chunk));
child.stdin.write("\n");

const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
process.exitCode = exitCode ?? 1;
