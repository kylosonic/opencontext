# Security Review

Last reviewed: 2026-11-07

This document records implementation-level controls and remaining deployment
work. It is not a penetration-test report.

## Verified controls

- **Upload type and size:** filename, size, extension, MIME type, and
  extension/MIME agreement are checked before an upload intent is issued.
  `complete` verifies stored-object metadata before creating a job.
- **Media validity and duration:** the worker probes the actual file and
  rejects non-video or over-30-minute files before analysis.
- **Ownership:** job read, delete, retry, evidence review, upload-body, and
  upload-complete routes require an authenticated session and compare the
  resource owner.
- **Worker authentication:** worker routes require a constant-time bearer-token
  comparison and the worker's claim id. An unset token denies every worker API
  request.
- **FFmpeg arguments:** subprocesses use list arguments with no shell. Media
  paths are passed as values to `-i`; option-like filenames cannot become
  commands. Automated tests pin this behavior.
- **Rate limiting:** upload intent creation, upload completion, retries, and
  evidence review are rate limited per user. The built-in limiter is
  per-process; distributed production deployments should also configure
  platform or WAF limits.
- **Temporary files:** worker jobs use isolated temporary directories and
  best-effort cleanup. Upload intents expire and are swept with their objects.
- **Direct transfer:** production media bytes go directly to object storage;
  the application does not proxy large upload bodies.

## Verified tests

- direct upload intent, size/MIME mismatch, missing object, date expiry, and
  cross-user access;
- job and evidence ownership;
- worker token acceptance/rejection;
- rate-limit windows and reset behavior;
- S3 `HEAD` metadata and presigned `PUT` command wiring;
- FFmpeg argument-list and option-like filename handling.

## Remaining deployment work

- Configure the S3 bucket with least-privilege credentials and CORS limited to
  the production web origin.
- Use a distributed rate limiter or platform WAF if traffic spans multiple
  instances.
- Add provider-specific Postgres migrations before making schema changes in a
  long-lived production database.
- Run an independent penetration test before claiming production security.
