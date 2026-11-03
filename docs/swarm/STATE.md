# OpenContext Project State

Last updated: 2026-11-03

## Status

Core product flows and the processing worker are implemented in the current working tree. The feature branch is still uncommitted and has not completed a fresh end-to-end verification or production rollout. Treat this as an implementation preview, not a release.

## Implemented in the working tree

- Public landing page, docs, deterministic demo, and reusable results viewer.
- GitHub authentication, protected app pages, upload form, job list/detail, retry/delete controls, and polling status.
- Prisma data model and initial migration, database-backed queue, local/S3-compatible storage, job APIs, and worker API.
- Python worker with FFmpeg probing/extraction, transcription and vision providers, OCR collection, aggregation, retries, and stage resume.
- Markdown and JSON context exports.
- Evidence-linked context: atomic transcript, visual, OCR, interaction, state-transition, and implementation findings receive stable IDs with timestamps and certainty. Result-viewer markers seek the source video when playback is available; timeline ranges are clickable too.
- Optional text-model refinement preserves evidence-bearing claims and timeline rows; altered anchors fall back to the deterministic template.
- Demo sample includes a small evidence ledger, so the citation UI can be explored without an account.
- Web and worker test suites exist in the tree.

## Current repository state

- Branch: `feat/slice-1-public-experience`.
- `HEAD`: `dc3b58f` (`chore: bootstrap OpenContext monorepo scaffold`).
- Current implementation is uncommitted. The working tree also reports `AGENTS.md` as deleted; this note does not infer whether that deletion is intentional.
- Prior status notes and product copy were stale; README, worker README, landing roadmap copy, behavior contract, and this state file now reflect the current working-tree scope.

## Verification and release gates

- No tests, lint, typecheck, build, or end-to-end run were executed during this continuation.
- Earlier notes reported lint/typecheck passing before the current evidence-link feature; those results do not verify this tree.
- Run web lint/typecheck/tests/build and worker ruff/pytest, then exercise one short synthetic upload through the web app and worker. Reconcile the TypeScript/Python job and evidence payloads.
- Complete upload/auth/worker-token/FFmpeg security review and the behavior checklist in `docs/behaviors/README.md`.
- Decide the production upload path: the current server-side upload flow supports 500 MB, while Vercel request limits may require direct-to-object-storage uploads.
- Configure GitHub OAuth, database, object storage, worker host, and model-provider credentials; deploy web and worker; verify the public demo and one real job.
- Refresh the README with deployed URLs and the final hosting decision after rollout.

## Product direction

Evidence-linked context is the current differentiator. The research notes are in `docs/research/agent-ready-video-context.md`. MCP/agent connections, repository-aware implementation briefs, and CI replay are later candidates and are not implemented.
