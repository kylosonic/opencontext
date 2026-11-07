# OpenContext Project State

Last updated: 2026-11-07

## Status

Core product flows and the processing worker are committed and tested, but
production provider, database, and worker configuration is incomplete. Treat
this as an implementation preview, not a public production release.

## Implemented

- Public landing page, docs, deterministic demo, and reusable results viewer.
- GitHub authentication, protected app pages, upload form, job list/detail, retry/delete controls, and polling status.
- Prisma data model and initial migration, database-backed queue, local/S3-compatible storage, job APIs, and worker API.
- Python worker with FFmpeg probing/extraction, transcription and vision providers, OCR collection, aggregation, retries, and stage resume.
- Markdown and JSON context exports.
- Evidence-linked context: atomic transcript, visual, OCR, interaction, state-transition, and implementation findings receive stable IDs with timestamps and certainty. Result-viewer markers seek the source video when playback is available; timeline ranges are clickable too.
- Optional text-model refinement preserves evidence-bearing claims and timeline rows; altered anchors fall back to the deterministic template.
- Demo sample includes a small evidence ledger, so the citation UI can be explored without an account.
- Job owners can confirm or flag evidence records, add reviewer notes or suggested corrections, and retain those annotations in the stored JSON and Markdown exports.
- Web and worker test suites exist in the tree.

## Current repository state

- Production branch: `main`; active development branch: `feat/slice-1-public-experience`.
- The MVP and evidence-review changes are committed on both branches. Commit `96cb84d` includes the deletion of `AGENTS.md`.
- Prior status notes and product copy were stale; README, worker README, landing roadmap copy, behavior contract, and this state file now reflect the current working-tree scope.

## Verification and release gates

- Web lint/typecheck and 99 tests passed; worker ruff and 114 tests passed. The production build succeeded.
- Vercel production: https://opencontext-swart.vercel.app (project root `apps/web`; connected to `kylosonic/opencontext`, with automatic deployments enabled for `main`).
- Smoke checks returned HTTP 200 for `/`, `/demo`, `/docs`, and `/auth/signin`.
- The generated-video test exercises direct upload, queue claim, worker processing, persisted evidence, and Markdown/JSON output.
- The upload/auth/ownership/worker-token/FFmpeg/rate-limit review is recorded in `docs/security-review.md`.
- Configure GitHub OAuth, a persistent database, object storage, worker host/token, and model-provider credentials; deploy the worker and verify one real job. OAuth and the Auth.js production secret are configured separately; OAuth provider credentials are still absent.
- Keep the `kylosonic/opencontext` Git connection and the `main` production branch active so production deployments remain automated.

## Product direction

Evidence-linked context is the current differentiator. The research notes are in `docs/research/agent-ready-video-context.md`. MCP/agent connections, repository-aware implementation briefs, and CI replay are later candidates and are not implemented.
