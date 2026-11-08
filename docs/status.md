# Project Status

Last verified: 2026-11-08

This page describes the repository and verification evidence, not a guarantee
about the current Vercel deployment or future releases.

## Verified in the repository

- Web lint, typecheck, and production build pass. The local suite reports 113
  passed plus one opt-in S3 integration skip; CI runs that integration and
  passes all web tests.
- Worker Ruff passes with 208 tests; real Tesseract and Ollama smoke tests are
  skipped locally unless their binaries/models and opt-in flags are present.
- A manual local smoke test produced a real Faster Whisper transcript from
  generated speech with no cloud credentials.
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

## Public deployment

The Vercel preview at
[opencontext-swart.vercel.app](https://opencontext-swart.vercel.app) serves the
landing page, deterministic demo, docs, and sign-in screen. Production GitHub
OAuth, a persistent database, object storage, and a worker are not fully
configured, so the public deployment is not a complete upload-processing
service.

## Known gaps

- No real-model quality evaluation is published, and Ollama vision has not
  been verified in this environment.
- Faster Whisper output from one generated speech sample proves setup, not
  transcription quality.
- Packages are not published.
- Eight moderate npm advisories remain in the TypeScript ESLint development
  toolchain; no high or critical advisories remain.
- No independent penetration test or high-traffic load test exists.
- Production OAuth, object storage, PostgreSQL, and worker deployment are not
  configured or deployed as a complete public service.

Scoped work is tracked in [ROADMAP.md](../ROADMAP.md) and
[docs/issues](issues/README.md).
