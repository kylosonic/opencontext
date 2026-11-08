import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "packages", "schemas", "src", "errors.ts"),
).href;
const { ERROR_CATALOG, ERROR_CODES, ERROR_STATUS } = await import(moduleUrl);

const catalogMarkdown = readFileSync(
  path.join(repoRoot, "docs", "api-errors.md"),
  "utf8",
);
const documented = [...catalogMarkdown.matchAll(
  /^\| `([A-Z_]+)` \| (\d{3}) \| (.+) \|$/gm,
)].map((match) => ({
  code: match[1],
  status: Number(match[2]),
  description: match[3].trim(),
}));

test("documented error rows are unique and complete", () => {
  const documentedCodes = documented.map((entry) => entry.code);
  assert.equal(new Set(documentedCodes).size, documentedCodes.length);
  assert.deepEqual(new Set(documentedCodes), new Set(ERROR_CODES));
});

test("catalog statuses and descriptions match the generated package", () => {
  for (const entry of documented) {
    assert.equal(entry.status, ERROR_CATALOG[entry.code].status);
    assert.equal(entry.status, ERROR_STATUS[entry.code]);
    assert.equal(entry.description, ERROR_CATALOG[entry.code].description);
    assert.ok(entry.description.length > 0);
  }
});
