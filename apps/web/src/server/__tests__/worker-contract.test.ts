import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AggregateDataSchema,
  AnalyzeDataSchema,
  ContextDataSchema,
  SourceMetaSchema,
  TranscriptSegmentSchema,
  WorkerProgressRequestSchema,
  WorkerStageResultRequestSchema,
} from "@opencontext/schemas";
import { findWorkerPython, workerPythonEnv } from "./python-process";

const python = findWorkerPython();

describe.skipIf(!python)("worker TypeScript/Python contract", () => {
  it("validates representative worker stage payloads with the shared schemas", () => {
    const stdout = execFileSync(python as string, ["-m", "oc_worker.contract"], {
      env: workerPythonEnv(),
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    });
    const sample = JSON.parse(stdout) as Record<string, unknown>;

    WorkerProgressRequestSchema.parse(sample.progress);
    SourceMetaSchema.parse(sample.extracting);

    const transcribing = sample.transcribing as { segments: unknown[] };
    transcribing.segments.forEach((segment) => TranscriptSegmentSchema.parse(segment));

    WorkerStageResultRequestSchema.parse({
      stage: "ANALYZING",
      outcome: "SUCCEEDED",
      attempt: 1,
      data: sample.analyzing,
    });
    AnalyzeDataSchema.parse(sample.analyzing);
    AggregateDataSchema.parse(sample.aggregating);

    WorkerStageResultRequestSchema.parse({
      stage: "GENERATING_CONTEXT",
      outcome: "SUCCEEDED",
      attempt: 1,
      data: sample.generatingContext,
    });
    const context = ContextDataSchema.parse(sample.generatingContext);
    expect(context.json.evidence?.length).toBeGreaterThan(0);
    expect(context.markdown).toContain("## Timeline");
  });
});
