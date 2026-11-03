import { z } from "zod";

/** What kind of binary artifact a Media row references. */
export const MEDIA_KINDS = ["SOURCE", "AUDIO", "FRAME"] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MediaKindSchema = z.enum(MEDIA_KINDS);

/** A Media row: a reference to a stored binary object (never the bytes). */
export const MediaSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  kind: MediaKindSchema,
  key: z.string(),
  mime: z.string().nullable().optional(),
  sizeBytes: z.number().int().nonnegative(),
  timestampSec: z.number().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  createdAt: z.string(),
});

export type Media = z.infer<typeof MediaSchema>;

/** Fields the worker sends when uploading an artifact (multipart `file`). */
export const ArtifactUploadSchema = z.object({
  kind: MediaKindSchema,
  timestampSec: z.coerce.number().optional(),
});
