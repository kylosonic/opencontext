import { z } from "zod";
import { TranscriptSegmentSchema } from "./transcript.js";
import {
  CertaintySchema,
  OCRObservationSchema,
  VisualObservationSchema,
} from "./observation.js";

/**
 * One entry of the AGGREGATING timeline payload. Fields beyond the
 * required pair are pass-through so the Python aggregation contract can
 * evolve without breaking the web schema.
 */
export const TimelineEntrySchema = z
  .looseObject({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
  })
  .refine((entry) => entry.end >= entry.start, {
    message: "timeline end must be greater than or equal to start",
    path: ["end"],
  });

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelinePayloadSchema = z.array(TimelineEntrySchema).max(10_000);

export type TimelinePayload = z.infer<typeof TimelinePayloadSchema>;

/** AGGREGATING stage-result data: the merged chronological timeline. */
export const AggregateDataSchema = z.object({
  timeline: TimelinePayloadSchema.max(10_000),
});

export type AggregateData = z.infer<typeof AggregateDataSchema>;

/** Points an evidence claim back to its source collection item. */
export const EvidenceSourceSchema = z.object({
  collection: z.string().min(1).max(128),
  index: z.number().int().nonnegative(),
  assetIndex: z.number().int().nonnegative().max(30).optional(),
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

/** A human annotation kept separate from the model's original claim. */
export const EvidenceReviewSchema = z.object({
  status: z.enum(["CONFIRMED", "FLAGGED"]),
  note: z.string().max(1000).optional(),
  correctedText: z.string().max(5000).optional(),
  reviewedAt: z.string().datetime(),
});

export type EvidenceReview = z.infer<typeof EvidenceReviewSchema>;

/** One atomic claim with timestamp and certainty for agent verification. */
export const EvidenceRecordSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(["TRANSCRIPT", "VISUAL", "OCR"]),
  timestampSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().nonnegative().optional(),
  certainty: CertaintySchema,
  text: z.string().min(1).max(20_000),
  source: EvidenceSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
  review: EvidenceReviewSchema.optional(),
});

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/** Additive evidence-ledger fields in worker context JSON. */
export const EvidenceLedgerSchema = z.object({
  evidenceVersion: z.literal(1),
  evidence: z.array(EvidenceRecordSchema).max(20_000),
});

export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;

const ContextJsonSchema = z.looseObject({
  formatVersion: z.number().int().nonnegative().optional(),
  evidenceVersion: z.literal(1).optional(),
  evidence: z.array(EvidenceRecordSchema).max(20_000).optional(),
});

/**
 * The full structured analysis result (mirrors the demo result shape).
 * Persisted in `ProcessingResult.json` and returned by the results API.
 */
export const ResultPayloadSchema = z.looseObject({
  formatVersion: z.number().int().nonnegative().default(1),
  markdown: z.string().max(10_000_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  transcript: z.array(TranscriptSegmentSchema).max(20_000).optional(),
  observations: z.array(VisualObservationSchema).max(300).optional(),
  ocr: z.array(OCRObservationSchema).max(10_000).optional(),
  timeline: TimelinePayloadSchema.max(10_000).optional(),
  evidenceVersion: z.literal(1).optional(),
  evidence: z.array(EvidenceRecordSchema).max(20_000).optional(),
});

export type ResultPayload = z.infer<typeof ResultPayloadSchema>;

/** GENERATING_CONTEXT stage-result data. */
export const ContextDataSchema = z.object({
  markdown: z.string().min(1).max(10_000_000),
  json: ContextJsonSchema,
});

export type ContextData = z.infer<typeof ContextDataSchema>;

/** A ProcessingResult row (upserted at GENERATING_CONTEXT). */
export const ProcessingResultSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  markdown: z.string().min(1).max(10_000_000),
  json: ContextJsonSchema,
  formatVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
  updatedAt: z.string(),
});

export type ProcessingResult = z.infer<typeof ProcessingResultSchema>;
