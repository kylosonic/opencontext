# Changelog

All notable changes are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

- Fixed the upload 429 lockout: a single 10-image set previously consumed all
  10 upload-intent slots for 10 minutes. The per-user intent budget is now 120
  per 10 minutes, rate-limit responses expose standard quota metadata, and
  limiter backend failures no longer masquerade as user quota exhaustion.
- Hardened provider throttling with one hosted-worker vision request at a time
  by default and three short in-stage retries. A longer upstream
  `Retry-After` now defers the job for up to 15 minutes through the shared
  queue instead of tying up the worker, and automatic claims increased from
  two to five. The scheduled OpenCode worker runs with
  `VISION_CONCURRENCY=1`.
- Image/video analysis now reports progress after every selected frame, cancels
  not-yet-started frames after a failure, and evenly samples long recordings
  to `VISION_MAX_FRAMES` (60 by default) so one job cannot exhaust its deadline
  on an unbounded frame count.
- Worker HTTP-library access logs are suppressed because they included full
  presigned object-storage URLs. Job, stage, status, and provider diagnostics
  remain visible.
- Active jobs whose worker disappears are claimable again when their lease
  expires. Previously only `QUEUED` rows were reclaimed, so a killed process
  could leave an `ANALYZING` job stuck indefinitely.
- Replay validation now accepts zero-duration still-image and PDF sources while
  retaining positive-duration checks for media timelines. All 13 downloaded
  corpus exports, including 11 images, now validate through `opencontext replay`.
- OpenCode requests now use an independent session ID per claimed job instead
  of sharing one process-wide session across every upload.
- Added reproducible downloaded photo/video smoke coverage across JPEG, PNG,
  WebP, MP4, short and longer video, and an audio-bearing trailer.
- Refreshed the npm lockfile, moved Next.js to 16.4.6, and pinned the patched
  `effect@3.22.5` transitive dependency. A full npm audit now reports zero
  known vulnerabilities.
- Added native Gemini vision through the Generative Language API. It is opt-in
  for the local Compose demo and available to CLI/worker diagnostics. Gemini
  keys stay in environment configuration, and the credential-free fixture
  provider remains the default.
- Added an opt-in real-vision mode for the local Compose demo. The fixture
  provider remains the default and continues to be labeled as fixture output;
  real mode validates the configured image-capable model and key before
  startup, and the end-to-end smoke test now checks a synthetic image as well
  as its video fixture.
- Fixed still-image conversion with FFmpeg 6.1 by removing an output-only
  `-autorotate` flag from the input arguments. EXIF orientation continues to
  be applied automatically exactly once and is now verified by rotated pixels.
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
- Added a standalone PostgreSQL web image, a hosted worker image, and a
  deployment-oriented Compose definition for a persistent container host.
  The web image starts migrations before serving and the deployment health
  check requires a successful result. The scheduled GitHub worker remains the
  live fallback until that stack is deployed.
- Added authenticated aggregate operations alerts for idle-worker heartbeat,
  queue age, long-running jobs, and recent failures. Workers now report their
  runtime state explicitly on claim errors and preserve object-storage error
  messages instead of masking them with an unread streaming response.
- Published `opencontext-video==0.1.0` on PyPI and
  `@kylosonic/opencontext-schemas@0.1.0` on npm. npm publishing now uses
  GitHub OIDC Trusted Publishing, so release workflows no longer need a
  long-lived publish token.
- Clamped speech-model segment bounds to the probed source duration, so a
  trailing Faster Whisper segment can no longer create evidence timestamps past
  the end of the recording.
- Added an audio-backed worker end-to-end test that transcribes the committed
  Harvard recording with real Faster Whisper, checks transcript WER/CER, and
  validates the evidence ledger and its timestamp bounds in CI.
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
