import { z } from "zod";
import { TranscriptSegmentSchema } from "./transcript";
import {
  CertaintySchema,
  OCRObservationSchema,
  VisualObservationSchema,
} from "./observation";

/**
 * One entry of the AGGREGATING timeline payload. Fields beyond the
 * required pair are pass-through so the Python aggregation contract can
 * evolve without breaking the web schema.
 */
export const TimelineEntrySchema = z.looseObject({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelinePayloadSchema = z.array(TimelineEntrySchema);

export type TimelinePayload = z.infer<typeof TimelinePayloadSchema>;

/** AGGREGATING stage-result data: the merged chronological timeline. */
export const AggregateDataSchema = z.object({
  timeline: TimelinePayloadSchema,
});

export type AggregateData = z.infer<typeof AggregateDataSchema>;

/** Points an evidence claim back to its source collection item. */
export const EvidenceSourceSchema = z.object({
  collection: z.string().min(1),
  index: z.number().int().nonnegative(),
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/** One atomic claim with timestamp and certainty for agent verification. */
export const EvidenceRecordSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(["TRANSCRIPT", "VISUAL", "OCR"]),
  timestampSec: z.number().nonnegative(),
  endSec: z.number().nonnegative().optional(),
  certainty: CertaintySchema,
  text: z.string(),
  source: EvidenceSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
});

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/** Additive evidence-ledger fields in worker context JSON. */
export const EvidenceLedgerSchema = z.object({
  evidenceVersion: z.literal(1),
  evidence: z.array(EvidenceRecordSchema),
});

export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;

const ContextJsonSchema = z.looseObject({
  evidenceVersion: z.literal(1).optional(),
  evidence: z.array(EvidenceRecordSchema).optional(),
});

/**
 * The full structured analysis result (mirrors the demo result shape).
 * Persisted in `ProcessingResult.json` and returned by the results API.
 */
export const ResultPayloadSchema = z.looseObject({
  formatVersion: z.number().int().nonnegative().default(1),
  markdown: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  transcript: z.array(TranscriptSegmentSchema).optional(),
  observations: z.array(VisualObservationSchema).optional(),
  ocr: z.array(OCRObservationSchema).optional(),
  timeline: TimelinePayloadSchema.optional(),
  evidenceVersion: z.literal(1).optional(),
  evidence: z.array(EvidenceRecordSchema).optional(),
});

export type ResultPayload = z.infer<typeof ResultPayloadSchema>;

/** GENERATING_CONTEXT stage-result data. */
export const ContextDataSchema = z.object({
  markdown: z.string(),
  json: ContextJsonSchema,
});

export type ContextData = z.infer<typeof ContextDataSchema>;

/** A ProcessingResult row (upserted at GENERATING_CONTEXT). */
export const ProcessingResultSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  markdown: z.string(),
  json: ContextJsonSchema,
  formatVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
  updatedAt: z.string(),
});

export type ProcessingResult = z.infer<typeof ProcessingResultSchema>;
