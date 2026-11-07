import { z } from "zod";

/**
 * Error codes used by the API error envelope:
 * `{"error": {"code", "message", "stage?"}}`.
 *
 * Codes match `docs/planning/technical-blueprint.md` §2 exactly; the worker
 * track mirrors these as Python constants.
 */
export const ERROR_CODES = [
  "FILE_TOO_LARGE",
  "FORMAT_UNSUPPORTED",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RETRY_NOT_ALLOWED",
  "UPLOAD_EXPIRED",
  "UPLOAD_INCOMPLETE",
  "RATE_LIMITED",
  "WORKER_UNAUTHORIZED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  stage: z.string().optional(),
});

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ErrorEnvelopeSchema = z.object({
  error: ErrorBodySchema,
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** HTTP status paired with each error code (blueprint §2: "400/413 named reasons"). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  FILE_TOO_LARGE: 413,
  FORMAT_UNSUPPORTED: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RETRY_NOT_ALLOWED: 409,
  UPLOAD_EXPIRED: 410,
  UPLOAD_INCOMPLETE: 409,
  RATE_LIMITED: 429,
  WORKER_UNAUTHORIZED: 401,
  INTERNAL: 500,
};

/** Skip reason recorded when TRANSCRIBING is skipped because the source has no audio. */
export const SKIP_REASON_NO_AUDIO = "NO_AUDIO";
