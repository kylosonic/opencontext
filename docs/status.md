# Project Status

Last verified: 2026-11-23

This page describes the repository and verification evidence, not a guarantee
about the current Vercel deployment or future releases.

## Verified in the repository

- Web lint, typecheck, production build, and the complete local suite pass. The
  local suite reports 182 passed plus one opt-in S3 integration skip; CI runs
  that integration and passes all web tests. Shared config contributes nine
  passing tests and the contract suite contributes two.
- Worker Ruff and all 323 local tests pass, with four environment-dependent
  skips. Real Tesseract and OpenCode Go vision/audio smoke tests run when their
  binaries or stored credentials and opt-in flags are present.
- The 429 regression path is covered at both layers: provider tests verify
  model cool-down/fallback behavior, and queue tests verify that a provider
  throttle can use its bounded 40-attempt quota budget while ordinary poison
  jobs still stop at five attempts.
- A manual local smoke test produced a real Faster Whisper transcript from
  generated speech with no cloud credentials.
- OpenCode Go `glm-5.3-flash` completed a real hosted-vision analysis of the
  generated fixture, producing 19 evidence records. The raw Markdown and JSON
  are published under `docs/evaluation/` and labeled as smoke evidence.
- The current opt-in OpenCode Go `glm-5.3-flash` smoke passed against a
  generated checkout-reference image through the full image pipeline. The test
  requires at least two expected UI or OCR labels and also confirms that the
  provider advertises image input.
- A measured OpenCode Go `glm-5.3-flash` run over a generated three-state UI
  flow matched all four expected OCR lines and all seven visual keywords,
  producing 70 evidence records. The input, configuration, raw context,
  score, methodology, and limitations are published under `docs/evaluation/`.
- An OpenCode Go `mimo-v2.6-pro` hearing run transcribed ten Harvard sentences
  from a 33.6-second Open Speech Repository recording with 1.23% WER and
  0.31% CER.
  The source audio, generated video script, context, score, attribution, and
  limits are published under `docs/evaluation/`.
- The hosted worker uses the current free, image-capable `hy4-flash-free`
  OpenCode Go model. A live production run on 2026-11-21 accepted a ten-image
  JPEG/PNG/WebP set, a standalone JPEG, a 5.06-second audio-bearing video, and
  a 52.21-second audio-bearing trailer after repeated `glm-5.3-flash` requests
  returned 429. All four jobs completed, produced 182 evidence records and
  nonempty Markdown/JSON exports, and passed `opencontext replay`.
- Cross-language contract test validates Python payloads with the shared Zod
  schemas.
- Generated-video test performs direct upload, queue claim, worker HTTP calls,
  real FFmpeg extraction, fixture transcription/vision, evidence persistence,
  and Markdown/JSON export.
- Generated image-set coverage verifies ordered uploads, cross-image context,
  vision/OCR output, and evidence-linked exports.
- Generated PDF coverage verifies upload and preview, page rendering, embedded
  text extraction, page count persistence, vision output, and exports across
  the web API and Python worker.
- SQLite migration chain matches the Prisma schema.
- PostgreSQL applies the checked-in migration baseline to a fresh database in
  CI, with no schema drift.
- S3-compatible integration covers presigned upload, metadata verification,
  move, job completion, and presigned worker download.
- Upload cancellation and partial-set cleanup, batch CLI analysis, provider
  diagnostics, shared database rate limiting, PostgreSQL migrations, and
  keyboard accessibility have focused tests.
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
- The `opencontext-mcp` stdio server exposes local video and image analysis,
  implementation brief generation, and bounded evidence lookup to coding
  agents.
- `opencontext evaluate` computes transcript WER/CER, OCR precision/recall/F1,
  and visual keyword recall against a versioned synthetic dataset, while keeping
  fixture baselines, smoke tests, and measured model runs separately labeled.
- The downloaded media corpus verifies 11 JPEG/PNG/WebP images and two real MP4
  videos. Every asset passed local offline analysis and `opencontext replay`;
  a fresh Docker Compose acceptance run then completed one mixed 10-image set,
  an eleventh standalone photo, and both videos. All four generated exports
  replayed successfully, and the fixture codec path uses the bundled
  `imageio-ffmpeg` binary rather than relying on a possibly codec-restricted
  host build.
- Python wheel and sdist build; `twine check` passes.
- Shared npm package builds and packs compiled ESM plus declarations.
- Prisma 7.10.1 uses driver adapters for SQLite and PostgreSQL; the migration
  chain applies to fresh SQLite and PostgreSQL databases.
- The production and full `npm audit` reports currently contain zero known
  vulnerabilities, including development tooling.
- Next.js uses the current `proxy.ts` request interception convention.
- Docker Compose was verified locally with PostgreSQL, web, and worker images;
  generated audio and video completed all five stages at 100%, producing
  evidence-linked Markdown and JSON. An existing model cache was migrated to
  the non-root worker and verified writable. Both the worker model cache and web
  media volume are initialized for their non-root owners. The worker uses
  bundled FFmpeg, so the default image does not install Debian multimedia
  packages.
- The worker entrypoint has a long-running supervisor with signal-driven
  graceful stop, bounded shutdown, retry backoff for API outages, and a
  per-job processing deadline. Focused tests cover an in-flight claim, active
  work, shutdown timeout, claim retries, and job expiry. A repeated race test
  accepted an in-flight job and completed it on every one of 100 runs.
- The website includes a persistent documentation shell with overview,
  quickstart, jobs API, package/CLI, agent, worker, status, and error pages.
- CI passes both a packaged-worker CLI smoke test and a full Compose login,
  upload, processing, Markdown export, and JSON export smoke test.
- `/api/health/ready` reports production configuration blockers without exposing
  secret values; it returns 503 until every required integration is configured.

## Public deployment

The deployment at
[opencontext-swart.vercel.app](https://opencontext-swart.vercel.app) runs the
full upload-to-export path: GitHub OAuth, Neon PostgreSQL, S3 through a
Vercel-managed OIDC role, and a Python worker. `/api/health/ready` returned
HTTP 200 with all six configuration checks on 2026-11-21.

On 2026-11-09 job `cmw9naxem000108ic8u0nvfyr` completed all five stages at
100% in production, producing evidence IDs, source timestamps, certainty
labels, Markdown, and JSON. The fixture video has no audio track, so that run
exercised vision, OCR, aggregation, and exports while transcription reported
"no audio".

The worker currently drains the queue from
`.github/workflows/worker-schedule.yml` every five minutes. It is a real worker,
not a simulation, but job start latency is up to one cron interval.

The 2026-11-21 production smoke covered ten ordered source images with 10
visual observations, a standalone JPEG with one observation, a 5.06-second
video with audio, transcript segments, and one visual observation, and the
52.21-second trailer with audio, four transcript segments, and six sampled
visual observations. Live result ledgers contained 84, 8, 14, and 76 evidence
records respectively. Every exported ledger replayed successfully without
provider credentials or source media.

The worker renews each claimed job's lease every minute so long stages do not
lose their claim between progress updates. CI verifies the heartbeat through
the non-root worker container and the Compose upload-to-export flow.

## Known gaps

- Published quality evidence covers one synthetic visual flow and one clean
  English read-speech sample. It does not establish broad vision or speech
  accuracy, noisy audio performance, or behavior on real application
  recordings.
- The live media acceptance corpus contains downloaded photographs and trailer
  footage, not a long real application walkthrough or a statistically
  representative sample of user-uploaded codecs and screen recordings.
- `opencontext-video==0.1.1` is published on PyPI and
  `@kylosonic/opencontext-schemas@0.1.1` is published on npm. Both use Trusted
  Publishing through their protected release workflows.
- `npm audit` reports zero known vulnerabilities at the time of verification;
  dependency advisories must still be rechecked on every release.
- No sustained high-traffic test against the deployed HTTP service or
  independent penetration test exists.
- A dedicated persistent worker deployment and runtime alerts have not been
  verified against a live host. Until they are, the recorded production worker
  remains the scheduled GitHub Actions drain.

Scoped work is tracked in [ROADMAP.md](../ROADMAP.md) and
[docs/issues](issues/README.md).
