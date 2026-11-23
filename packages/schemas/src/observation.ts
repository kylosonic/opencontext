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
  id: z.string().max(256).optional(),
  jobId: z.string().max(256).optional(),
  frameId: z.string().max(256).nullable().optional(),
  sourceIndex: z.number().int().nonnegative().max(30).optional(),
  timestampSec: z.number().finite().nonnegative(),
  certainty: CertaintySchema.default("OBSERVED"),
  sceneTitle: z.string().max(2_000).optional(),
  visualDescription: z.string().max(20_000).optional(),
  uiElements: z.array(z.string().max(20_000)).max(500).default([]),
  visibleText: z.array(z.string().max(20_000)).max(1_000).default([]),
  interactions: z.array(z.string().max(20_000)).max(500).default([]),
  layoutDescription: z.string().max(20_000).optional(),
  designObservations: z.record(z.string(), z.unknown()).default({}),
  importantChanges: z.array(z.string().max(20_000)).max(500).default([]),
  provider: z.string().max(128).optional(),
  model: z.string().max(256).optional(),
  createdAt: z.string().optional(),
}).refine((observation) => Object.keys(observation.designObservations).length <= 200, {
  message: "designObservations contains too many entries",
  path: ["designObservations"],
});

export type VisualObservation = z.infer<typeof VisualObservationSchema>;

/** One text run extracted from a frame by the vision provider (OCR). */
export const OCRObservationSchema = z.object({
  id: z.string().max(256).optional(),
  jobId: z.string().max(256).optional(),
  frameId: z.string().max(256).nullable().optional(),
  sourceIndex: z.number().int().nonnegative().max(30).optional(),
  timestampSec: z.number().finite().nonnegative(),
  text: z.string().min(1).max(20_000),
  confidence: z.number().min(0).max(1).optional(),
  provider: z.string().max(128).optional(),
  createdAt: z.string().optional(),
});

export type OCRObservation = z.infer<typeof OCRObservationSchema>;

/** ANALYZING stage-result data: observations + OCR rows. */
export const AnalyzeDataSchema = z.object({
  observations: z.array(VisualObservationSchema).max(300),
  ocr: z.array(OCRObservationSchema).max(10_000),
});

export type AnalyzeData = z.infer<typeof AnalyzeDataSchema>;
