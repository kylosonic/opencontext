# Project Status

Last verified: 2026-11-09

This page describes the repository and verification evidence, not a guarantee
about the current Vercel deployment or future releases.

## Verified in the repository

- Web lint, typecheck, and production build pass. The local suite reports 123
  passed plus one opt-in S3 integration skip; CI runs that integration and
  passes all web tests.
- Worker Ruff passes with 234 tests; real Tesseract and OpenCode Go vision/audio
  smoke tests are skipped unless their binaries/credentials and opt-in flags
  are present.
- A manual local smoke test produced a real Faster Whisper transcript from
  generated speech with no cloud credentials.
- OpenCode Go `glm-5.3-flash` completed a real hosted-vision analysis of the
  generated fixture, producing 19 evidence records. The raw Markdown and JSON
  are published under `docs/evaluation/` and labeled as smoke evidence.
- A measured OpenCode Go `glm-5.3-flash` run over a generated three-state UI
  flow matched all four expected OCR lines and all seven visual keywords,
  producing 70 evidence records. The input, configuration, raw context,
  score, methodology, and limitations are published under `docs/evaluation/`.
- An OpenCode Go `mimo-v2.6-pro` hearing run transcribed ten Harvard sentences
  from a 33.6-second Open Speech Repository recording with 1.23% WER and
  0.31% CER.
  The source audio, generated video script, context, score, attribution, and
  limits are published under `docs/evaluation/`.
- Cross-language contract test validates Python payloads with the shared Zod
  schemas.
- Generated-video test performs direct upload, queue claim, worker HTTP calls,
  real FFmpeg extraction, fixture transcription/vision, evidence persistence,
  and Markdown/JSON export.
- SQLite migration chain matches the Prisma schema.
- PostgreSQL applies the checked-in migration baseline to a fresh database in
  CI, with no schema drift.
- S3-compatible integration covers presigned upload, metadata verification,
  move, job completion, and presigned worker download.
- Upload cancellation, batch CLI analysis, provider diagnostics, shared
  database rate limiting, PostgreSQL migrations, and keyboard accessibility
  have focused tests.
- A PostgreSQL load test with six independent processes and 150 synchronized
  requests per round allowed exactly 37 requests on each fresh key and
  persisted exactly 37 slots across four rounds. The raw result and limits are
  published under `docs/performance/`.
- `opencontext --version` reads installed package metadata, `doctor --json`
  emits ordered readiness checks without credential values, and provider
  factories name invalid settings and missing credentials explicitly.
- Every remote provider mode has focused 4xx permanent and 408/429/5xx
  transient failure coverage.
- The public API error catalog is generated from the shared contract and has a
  drift test. Owner-only Markdown and JSON result exports are available through
  `/api/jobs/[id]/export`.
- `opencontext brief` turns context JSON into a repository-aware implementation
  prompt while preserving evidence IDs and separating uncertain claims.
- `opencontext replay` validates a captured evidence ledger against its source
  collections, timestamps, and timeline before regenerating an implementation
  brief. CI replays the published 70-record OpenCode context without media,
  provider credentials, or network access.
- The `opencontext-mcp` stdio server exposes local video analysis, implementation
  brief generation, and bounded evidence lookup to coding agents.
- `opencontext evaluate` computes transcript WER/CER, OCR precision/recall/F1,
  and visual keyword recall against a versioned synthetic dataset, while keeping
  fixture baselines, smoke tests, and measured model runs separately labeled.
- Python wheel and sdist build; `twine check` passes.
- Shared npm package builds and packs compiled ESM plus declarations.
- Prisma 7.10.1 uses driver adapters for SQLite and PostgreSQL; the migration
  chain applies to fresh SQLite and PostgreSQL databases.
- No high or critical npm advisories remain. Eight moderate findings are
  confined to the TypeScript ESLint development toolchain.
- Next.js uses the current `proxy.ts` request interception convention.
- Docker Compose was verified locally with PostgreSQL, web, and worker images;
  a generated upload completed all five stages at 100% and produced
  evidence-linked Markdown. The worker uses bundled FFmpeg, so the default
  image does not install Debian multimedia packages.
- CI passes both a packaged-worker CLI smoke test and a full Compose login,
  upload, processing, Markdown export, and JSON export smoke test.
- `/api/health/ready` reports production configuration blockers without exposing
  secret values; it returns 503 until every required integration is configured.

## Public deployment

The deployment at
[opencontext-swart.vercel.app](https://opencontext-swart.vercel.app) runs the
full upload-to-export path: GitHub OAuth, Neon PostgreSQL, S3 through a
Vercel-managed OIDC role, and a Python worker. `/api/health/ready` returned
HTTP 200 with all six configuration checks on 2026-11-09.

On 2026-11-09 job `cmw9naxem000108ic8u0nvfyr` completed all five stages at
100% in production, producing evidence IDs, source timestamps, certainty
labels, Markdown, and JSON. The fixture video has no audio track, so that run
exercised vision, OCR, aggregation, and exports while transcription reported
"no audio".

The worker currently drains the queue from
`.github/workflows/worker-schedule.yml` every five minutes. It is a real worker,
not a simulation, but job start latency is up to one cron interval.

## Known gaps

- Published quality evidence covers one synthetic visual flow and one clean
  English read-speech sample. It does not establish broad vision or speech
  accuracy, noisy audio performance, or behavior on real application
  recordings.
- Packages are not published.
- Eight moderate npm advisories remain in the TypeScript ESLint development
  toolchain; no high or critical advisories remain.
- No sustained high-traffic test against the deployed HTTP service or
  independent penetration test exists.
- The worker is scheduled rather than long-running, so queue latency and
  GitHub Actions minute usage are higher than a dedicated worker host.

Scoped work is tracked in [ROADMAP.md](../ROADMAP.md) and
[docs/issues](issues/README.md).
