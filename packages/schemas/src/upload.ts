import { z } from "zod";
import { DetailLevelSchema, UPLOAD_LIMITS } from "./job.js";

/** POST /api/uploads — create a short-lived direct-upload intent. */
export const UploadIntentRequestSchema = z
  .object({
    filename: z.string().min(1).max(255),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(UPLOAD_LIMITS.maxBytes),
    mime: z.string().max(128).optional(),
    detailLevel: DetailLevelSchema.default("MEDIUM"),
  })
  .strict();

export type UploadIntentRequest = z.infer<typeof UploadIntentRequestSchema>;

/** The browser uploads to `url` with `method`, then calls the complete route. */
export const UploadIntentResponseSchema = z.object({
  uploadId: z.string().min(1),
  method: z.literal("PUT"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});

export type UploadIntentResponse = z.infer<typeof UploadIntentResponseSchema>;
