# Security Review

Last reviewed: 2026-11-24

This document records implementation-level controls and remaining deployment
work. It is not a penetration-test report.

## Verified controls

- **Upload type and size:** filename, size, extension, MIME type, and
  extension/MIME agreement are checked before an upload intent is issued.
  `complete` verifies stored-object metadata before creating a job, and an
  atomic intent claim prevents concurrent completion from creating duplicate
  jobs. Source moves complete before a job becomes claimable.
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
- **Rate limiting:** authentication, upload intent creation/completion/body/
  cancellation, job reads/retries/deletes, source and export reads, evidence
  review, worker APIs, operations reads, retention sweeps, and demo endpoints
  are rate limited. A maximum 10-image set uses 10 of 240 upload-intent slots
  per 10 minutes, avoiding a one-set lockout while retaining a bounded abuse
  budget. `memory` is the local
  single-instance default; `database` shares fixed-window quotas through the
  application database for multi-instance deployments. A PostgreSQL test with
  six independent processes verified that concurrent requests cannot exceed
  the stored quota. Backend failure can be configured fail-open or fail-closed,
  and platform/WAF limits remain useful. Fail-open mode now falls back to the
  in-process quota instead of disabling limits entirely; fail-closed mode maps
  an unavailable limiter to a service error rather than a misleading 429.
  Address keys use platform identity on Vercel or an explicitly configured
  trusted-proxy chain elsewhere; untrusted address headers are ignored.
- **Temporary files:** worker jobs use isolated temporary directories and
  best-effort cleanup. Upload intents expire and are swept with their objects.
- **Worker artifacts:** artifact writes are upload-unique and lease-fenced.
  A worker that loses its lease cannot overwrite or delete a successor
  worker's committed artifact, and deleting a job revokes its lease first.
- **Direct transfer:** production media bytes go directly to object storage;
  the application does not proxy large upload bodies.
- **Dependency advisories:** dependencies were refreshed on 2026-11-21,
  including Next.js 16.4.6, and the full `npm audit` reports zero known
  vulnerabilities.
- **Worker logs:** the worker suppresses HTTP library access logs because they
  include full presigned object-storage URLs. Secrets stay out of application
  logs, and long provider throttles are deferred without printing credentials
  or media bytes.
- **Provider throttling:** an upstream HTTP 429 no longer holds a worker in a
  tight retry loop. The model is cooled down, a configured fallback model is
  tried, and exhausted quotas defer the job through the bounded shared queue.
  Rate-limited jobs have a separate 40-attempt ceiling with escalating
  cooldowns; ordinary crash/poison jobs retain the five-attempt ceiling.
- **Browser mutation boundaries:** JSON and multipart bodies have incremental
  byte caps and content types are enforced. Cross-site and same-site mutations
  are rejected; browser mutations without `Origin` require same-origin request
  metadata or a non-simple JSON content type. Forwarded host headers are used
  only on Vercel or behind an explicitly configured trusted proxy.
- **Readiness disclosure:** the public health response reveals only aggregate
  readiness and its timestamp. Per-subsystem diagnostics require the operations
  bearer token, use constant-time comparison, and never contain credentials.

## Verified tests

- direct upload intent, size/MIME mismatch, missing object, date expiry, and
  cross-user access;
- job and evidence ownership;
- worker token acceptance/rejection;
- rate-limit windows, reset behavior, and multi-process PostgreSQL contention;
- trusted-proxy key selection, spoof rejection, and immutable auth redirects;
- concurrent upload completion and stale-worker artifact races;
- S3 `HEAD` metadata and presigned `PUT` command wiring;
- FFmpeg argument-list and option-like filename handling.

## Remaining deployment work

- Validate the new PostgreSQL pool limits and Vercel WAF policy against
  representative sustained traffic before treating their thresholds as tuned.
- Apply and verify the checked-in PostgreSQL migration before deploying code
  that depends on a schema change.
- Run an independent penetration test before claiming production security.

The repository now includes bounded PostgreSQL pool configuration, an auditable
Vercel WAF preview/apply script, and a weekly OWASP ZAP baseline workflow.
Those controls are implementation evidence, not substitutes for production
traffic review or independent testing. The independent-assessment scope and
acceptance checklist are in
[`docs/security/independent-assessment.md`](security/independent-assessment.md).

The production bucket now uses a Vercel-managed OIDC role instead of long-lived
AWS keys, and its CORS policy allows only the production web origin for
`GET`, `PUT`, and `HEAD`.
