# Project Status

Last verified: 2026-11-08

This page describes the repository and verification evidence, not a guarantee
about the current Vercel deployment or future releases.

## Verified in the repository

- Web lint, typecheck, and production build pass. The local suite reports 111
  passed plus one opt-in S3 integration skip; CI runs that integration and
  passes all web tests.
- Worker Ruff passes with 124 tests; the real Tesseract smoke test is skipped
  locally because the binary is absent and runs successfully in CI.
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
- Python wheel and sdist build; `twine check` passes.
- Shared npm package builds and packs compiled ESM plus declarations.
- No critical npm advisories remain after the Next.js, Zod, and Vitest updates.
- Next.js uses the current `proxy.ts` request interception convention.

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
- Docker Compose configuration validates, but the full image stack has not been
  verified end to end in the current environment.
- Packages are not published.
- The Prisma 6 CLI has a high-severity transitive `deepmerge-ts` advisory;
  additional moderate npm advisories affect development tooling only.
- No independent penetration test or high-traffic load test exists.
- Production OAuth, object storage, PostgreSQL, and worker deployment are not
  configured or deployed as a complete public service.

Scoped work is tracked in [ROADMAP.md](../ROADMAP.md) and
[docs/issues](issues/README.md).
