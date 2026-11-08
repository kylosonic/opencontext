# ADR-0006: Direct object-storage uploads

Status: Accepted (2026-11-07)

## Context

Serverless request-body limits and the existing 500 MB cap made the original
multipart upload path unsuitable for production. Large video bytes should not
pass through the Next.js runtime.

## Decision

Uploads use three steps:

1. `POST /api/uploads` validates filename, size, MIME, and detail level, then
   creates a 15-minute `UploadIntent` and returns a presigned S3 `PUT` URL.
2. The browser uploads directly to object storage.
3. `POST /api/uploads/[id]/complete` checks ownership and object metadata,
   validates the exact size and content type, moves the object to its final
   key, and creates the queued job.

Local development uses the same intent/complete flow. The returned URL points
to a session-authenticated local upload sink instead of S3.

## Consequences

- Large media never traverses the web application.
- The object is not trusted until server-side metadata verification passes.
- Worker FFmpeg probing remains the authority for actual media validity and
  duration.
- S3-compatible buckets must allow `PUT` CORS from the web origin.
- Expired intents and their temporary objects are removed by the retention
  sweeper and opportunistically when a user starts another upload.
