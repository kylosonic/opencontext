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

/** Public API error contract, including the HTTP status and operator meaning. */
export const ERROR_CATALOG = {
  FILE_TOO_LARGE: {
    status: 413,
    description: "The upload exceeds the configured media size limit.",
  },
  FORMAT_UNSUPPORTED: {
    status: 400,
    description: "The media extension or detected format is not supported.",
  },
  VALIDATION_ERROR: {
    status: 400,
    description: "A request body, query, or path parameter is invalid.",
  },
  UNAUTHORIZED: {
    status: 401,
    description: "A user session is absent, expired, or invalid.",
  },
  FORBIDDEN: {
    status: 403,
    description: "The authenticated identity cannot access this resource.",
  },
  NOT_FOUND: {
    status: 404,
    description: "The requested resource does not exist or is not visible.",
  },
  RETRY_NOT_ALLOWED: {
    status: 409,
    description: "The job state does not permit another processing attempt.",
  },
  UPLOAD_EXPIRED: {
    status: 410,
    description: "The upload intent expired before the object was completed.",
  },
  UPLOAD_INCOMPLETE: {
    status: 409,
    description: "The uploaded object is missing or does not match its intent.",
  },
  RATE_LIMITED: {
    status: 429,
    description: "The caller exceeded the configured request rate.",
  },
  WORKER_UNAUTHORIZED: {
    status: 401,
    description: "The worker token or worker identity is invalid.",
  },
  INTERNAL: {
    status: 500,
    description: "The server encountered an unexpected internal failure.",
  },
} as const satisfies Record<ErrorCode, { status: number; description: string }>;

/** HTTP status paired with each error code. */
export const ERROR_STATUS = Object.fromEntries(
  Object.entries(ERROR_CATALOG).map(([code, entry]) => [code, entry.status]),
) as Record<ErrorCode, number>;

/** Skip reason recorded when TRANSCRIBING is skipped because the source has no audio. */
export const SKIP_REASON_NO_AUDIO = "NO_AUDIO";
