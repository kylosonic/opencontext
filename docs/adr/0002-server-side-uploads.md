# ADR-0002: Server-side multipart uploads for the MVP

Status: Accepted (2026-09-02)

## Context
The master prompt prefers signed object-storage uploads but says "should ideally." Signed uploads require a configured bucket + presign flow, which cannot be verified in the current environment (no object storage service configured).

## Decision
MVP uploads go through the web app as validated multipart requests (500 MB cap, format/extension checks, per `docs/behaviors/upload.md`), written through the storage abstraction. Direct signed uploads are future work.

## Consequences
- Works identically on every deployment, including local dev.
- Server must buffer/stream uploads — size cap enforced before processing.
- The storage abstraction (ADR-0004) is the seam for later presigned-upload migration.

## Rejected alternatives
- Presigned uploads now: blocked on bucket credentials; delays MVP.
