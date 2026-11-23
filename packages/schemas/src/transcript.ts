import { z } from "zod";

/** One spoken-text segment produced by the transcription stage. */
export const TranscriptSegmentSchema = z
  .object({
    id: z.string().max(256).optional(),
    jobId: z.string().max(256).optional(),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string().min(1).max(20_000),
    provider: z.string().max(128).optional(),
    createdAt: z.string().optional(),
  })
  .refine((segment) => segment.end >= segment.start, {
    message: "transcript end must be greater than or equal to start",
    path: ["end"],
  });

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSegmentsSchema = z.array(TranscriptSegmentSchema).max(20_000);
