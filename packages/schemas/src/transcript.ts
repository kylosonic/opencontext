import { z } from "zod";

/** One spoken-text segment produced by the transcription stage. */
export const TranscriptSegmentSchema = z.object({
  id: z.string().optional(),
  jobId: z.string().optional(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  provider: z.string().optional(),
  createdAt: z.string().optional(),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptSegmentsSchema = z.array(TranscriptSegmentSchema);
