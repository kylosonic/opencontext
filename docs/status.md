# Project Status

Last verified: 2026-11-08

This page describes the repository and verification evidence, not a guarantee
about the current Vercel deployment or future releases.

## Verified in the repository

- Web lint, typecheck, 101 tests, and production build pass.
- Worker Ruff and 114 tests pass.
- Cross-language contract test validates Python payloads with the shared Zod
  schemas.
- Generated-video test performs direct upload, queue claim, worker HTTP calls,
  real FFmpeg extraction, fixture transcription/vision, evidence persistence,
  and Markdown/JSON export.
- SQLite migration chain matches the Prisma schema.
- Python wheel and sdist build; `twine check` passes.
- Shared npm package builds and packs compiled ESM plus declarations.

## Public deployment

The Vercel preview at
[opencontext-swart.vercel.app](https://opencontext-swart.vercel.app) serves the
landing page, deterministic demo, docs, and sign-in screen. Production GitHub
OAuth, a persistent database, object storage, and a worker are not fully
configured, so the public deployment is not a complete upload-processing
service.

## Known gaps

- No real-model quality evaluation is published.
- Docker Compose configuration validates, but the full image build was not
  completed in the recorded local environment because Debian downloads stalled.
- PostgreSQL uses a bootstrap `db push` flow; provider-specific migrations are
  planned.
- Packages are not published.
- No independent penetration test or high-traffic load test exists.
- Distributed rate limiting and S3/MinIO end-to-end tests remain open.

Scoped work is tracked in [ROADMAP.md](../ROADMAP.md) and
[docs/issues](issues/README.md).
