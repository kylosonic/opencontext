# Security Review

Last reviewed: 2026-11-09

This document records implementation-level controls and remaining deployment
work. It is not a penetration-test report.

## Verified controls

- **Upload type and size:** filename, size, extension, MIME type, and
  extension/MIME agreement are checked before an upload intent is issued.
  `complete` verifies stored-object metadata before creating a job.
- **Media validity and duration:** the worker probes the actual file and
  rejects non-video or over-30-minute files before analysis.
- **Ownership:** job read, delete, retry, export, evidence review, upload-body, and
  upload-complete routes require an authenticated session and compare the
  resource owner.
- **Worker authentication:** worker routes require a constant-time bearer-token
  comparison and the worker's claim id. An unset token denies every worker API
  request.
- **FFmpeg arguments:** subprocesses use list arguments with no shell. Media
  paths are passed as values to `-i`; option-like filenames cannot become
  commands. Automated tests pin this behavior.
- **Rate limiting:** upload intent creation, completion, cancellation, retries,
  and evidence review are rate limited per user. `memory` is the local
  single-instance default; `database` shares fixed-window quotas through the
  application database for multi-instance deployments. A PostgreSQL test with
  six independent processes verified that concurrent requests cannot exceed
  the stored quota. Backend failure can be configured fail-open or fail-closed,
  and platform/WAF limits remain useful.
- **Temporary files:** worker jobs use isolated temporary directories and
  best-effort cleanup. Upload intents expire and are swept with their objects.
- **Direct transfer:** production media bytes go directly to object storage;
  the application does not proxy large upload bodies.
- **Dependency advisories:** the 2026-11-08 audit findings that affected
  network-facing runtime packages were resolved by upgrading Next.js to
  16.4.5, Zod to 4.6.7, Vitest to 5.1.0, and Prisma to 7.10.1 with driver
  adapters. No high or critical npm advisories remain; eight moderate findings
  are confined to the TypeScript ESLint development toolchain.

## Verified tests

- direct upload intent, size/MIME mismatch, missing object, date expiry, and
  cross-user access;
- job and evidence ownership;
- worker token acceptance/rejection;
- rate-limit windows, reset behavior, and multi-process PostgreSQL contention;
- S3 `HEAD` metadata and presigned `PUT` command wiring;
- FFmpeg argument-list and option-like filename handling.

## Remaining deployment work

- Tune database connection pools and add platform/WAF controls based on
  sustained production traffic.
- Add provider-specific Postgres migrations before making schema changes in a
  long-lived production database.
- Run an independent penetration test before claiming production security.

The production bucket now uses a Vercel-managed OIDC role instead of long-lived
AWS keys, and its CORS policy allows only the production web origin for
`GET`, `PUT`, and `HEAD`.
