# Changelog

All notable changes are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

- Added a graceful long-running worker supervisor, a configurable per-job
  processing deadline, claim-error backoff, and bounded container shutdown.
  The worker container now explicitly receives `SIGTERM`.
- Rebuilt the public docs as a navigable reference with overview, quickstart,
  jobs API, package and CLI, agent integration, worker deployment, status, and
  error catalog pages. Replaced roadmap claims for already-shipped MCP and
  repository brief features with verified usage guidance.
- Made the local Compose stack explicitly development-mode, added readiness and
  worker health checks, repaired ownership of its model cache, and verified
  audio-backed upload through evidence-linked exports.
- Published `opencontext-video==0.1.0` on PyPI and
  `@kylosonic/opencontext-schemas@0.1.0` on npm. npm publishing now uses
  GitHub OIDC Trusted Publishing, so release workflows no longer need a
  long-lived publish token.
- Added a worker lease heartbeat so long transcription and vision stages keep
  their queue claim, and made the worker container run as an unprivileged user.
- Added PNG, JPEG, and WebP image inputs, including ordered sets of up to 10
  images. Upload completion validates each object before creating one job, and
  the worker adds cross-image text and UI changes to the Markdown and JSON
  output.
- Added PDF ingestion up to 50 MB and 30 pages. PDF pages are rendered in order,
  embedded text becomes OCR evidence, and the result viewer includes an
  authenticated PDF preview.
- Hardened still-image ingestion with signature checks, Sharp metadata
  validation, a 40-megapixel ceiling, EXIF orientation handling, transparency
  flattening, and metadata stripping before vision analysis.
- Verified a production upload-to-export job on Vercel, Neon PostgreSQL, S3 via
  Vercel OIDC, and the scheduled GitHub Actions worker.
- Fixed S3 artifact uploads to use a Node readable stream and to calculate only
  required checksums.
- Fixed presigned worker downloads so API auth headers are not sent to S3.
- Distinguished "no audio track" from "audio track contained no speech" in
  context markdown and the transcript tab.
- Credential-free local pipeline mode with explicitly labeled fixture providers.
- Generated-video end-to-end coverage and cross-language contract validation.
- Docker Compose stack for web, worker, and PostgreSQL.
- Standalone `opencontext analyze` CLI.
- Publishable `opencontext-video` Python package and
  `@kylosonic/opencontext-schemas` npm package.
- Patched reachable npm dependency advisories and documented the remaining
  development-tool audit findings.
- Verified a real Faster Whisper transcription locally and pinned PyAV below
  19 for compatibility with Faster Whisper 1.2.1.
- Added active-upload cancellation and temporary-object cleanup.
- Added collision-safe directory/batch CLI analysis and JSON summaries.
- Added `opencontext doctor` with bounded, secret-safe provider diagnostics.
- Added optional database-backed rate limiting with fail-open/fail-closed modes.
- Added keyboard and screen-reader coverage for result tabs, timelines, and
  evidence controls.
- Added a PostgreSQL migration baseline, deploy command, and CI drift check.
- Added real S3-compatible storage integration coverage.
- Added independent Tesseract OCR with fixture and vision-compatible modes.
- Replaced the deprecated Next.js middleware convention with `proxy.ts`.
- Made the default Compose stack runnable with Auth.js trusted-host handling
  and a bundled FFmpeg binary, and verified a completed local upload.
- Upgraded Prisma to 7.10.1 with SQLite and PostgreSQL driver adapters, removing
  the remaining high-severity npm advisory.
- Added a single package-derived CLI version, machine-readable `doctor --json`,
  actionable provider configuration errors, and consistent provider retry
  classification.
- Added a generated public API error catalog and owner-only Markdown/JSON export
  endpoints.
- Added opt-in real Ollama vision smoke coverage plus packaged-container and
  full Compose upload-to-export CI jobs.
- Added deterministic repository-aware implementation briefs and a local MCP
  server exposing analysis, brief generation, and evidence lookup to coding
  agents.
- Added a reproducible model-quality evaluation harness with transcript,
  OCR, visual recall, provenance, licensing, and measurement-kind reporting.
- Added OpenCode Go API-key and session-header support and verified
  `glm-5.3-flash` on a generated video with normalized evidence output.
- Added a reproducible three-state evaluation video, CC0 manifest, and measured
  OpenCode Go vision/OCR result with published context, score, and limits.
- Added a multi-process PostgreSQL rate-limiter load test that verifies shared
  quotas and persisted counts under synchronized contention.
- Added `opencontext replay` for credential-free validation and regeneration
  of implementation briefs from committed video-context artifacts in CI.
- Added an audio-chat transcription provider and a reproducible attributed
  Open Speech Repository hearing measurement with published WER/CER evidence.

## 0.1.0 - 2026-11-03

- Initial OpenContext MVP with authenticated jobs, local/S3 storage, a
  database-backed queue, a Python media worker, evidence-linked context, and
  Markdown/JSON exports.
