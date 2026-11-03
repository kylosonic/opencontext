import { z } from "zod";

/** Confidence a visual observation is a true description of the frame. */
export const CERTAINTIES = ["OBSERVED", "INFERRED", "UNCERTAIN"] as const;

export type Certainty = (typeof CERTAINTIES)[number];

export const CertaintySchema = z.enum(CERTAINTIES);

/**
 * A visual observation of a frame. Collection fields are Json arrays of
 * strings; uncertain sub-fields carry `"uncertain": true` flags.
 */
export const VisualObservationSchema = z.object({
  id: z.string().optional(),
  jobId: z.string().optional(),
  frameId: z.string().nullable().optional(),
  timestampSec: z.number().nonnegative(),
  certainty: CertaintySchema.default("OBSERVED"),
  sceneTitle: z.string().optional(),
  visualDescription: z.string().optional(),
  uiElements: z.array(z.string()).default([]),
  visibleText: z.array(z.string()).default([]),
  interactions: z.array(z.string()).default([]),
  layoutDescription: z.string().optional(),
  designObservations: z.record(z.string(), z.unknown()).default({}),
  importantChanges: z.array(z.string()).default([]),
  provider: z.string().optional(),
  createdAt: z.string().optional(),
});

export type VisualObservation = z.infer<typeof VisualObservationSchema>;

/** One text run extracted from a frame by the vision provider (OCR). */
export const OCRObservationSchema = z.object({
  id: z.string().optional(),
  jobId: z.string().optional(),
  frameId: z.string().nullable().optional(),
  timestampSec: z.number().nonnegative(),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  provider: z.string().optional(),
  createdAt: z.string().optional(),
});

export type OCRObservation = z.infer<typeof OCRObservationSchema>;

/** ANALYZING stage-result data: observations + OCR rows. */
export const AnalyzeDataSchema = z.object({
  observations: z.array(VisualObservationSchema),
  ocr: z.array(OCRObservationSchema),
});

export type AnalyzeData = z.infer<typeof AnalyzeDataSchema>;
