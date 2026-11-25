# Project Status

Last verified: 2026-11-24

This page describes the repository and verification evidence, not a guarantee
about the current Vercel deployment or future releases.

## Verified in the repository

- Web lint, typecheck, production build, and the complete local suite pass. The
  local web suite reports 251 passed plus two env-gated skips
  (`storage.s3.integration.test.ts` and `url-import.e2e.test.ts`); CI runs the
  S3 integration against S3Mock. Shared config contributes nine passing tests
  and the contract suite contributes five.
- Worker Ruff and all 356 local tests pass, with four environment-dependent
  skips (`test_audio_e2e.py`, `test_ocr_providers.py`,
  `test_opencode_audio_smoke.py`, and `test_opencode_vision_smoke.py`). Real
  Tesseract and OpenCode Go vision/audio smoke tests run when their binaries or
  stored credentials and opt-in flags are present.
- UI consistency, accessibility, team RBAC UI gating, interactive public share
  controls, landing page, and in-app docs parity checks were audited and
  verified across `apps/web`.
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
  persisted exactly 37 slots across four rounds: 148 allowed and 452 correctly
  blocked out of 600 attempts. The raw result and limits are published under
  `docs/performance/`.
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
- A freshly downloaded media corpus verified 10 JPEG/PNG/WebP images and two
  real MP4 videos. Every asset passed local offline analysis and `replay`; a
  fresh Docker Compose acceptance run then completed one mixed
  10-image set, an additional standalone photo, and both videos. The four jobs
  produced 208 evidence records in total, including four real Faster Whisper
  transcript segments for the 52-second trailer, and every exported ledger
  replayed successfully. The fixture codec path uses the bundled
  `imageio-ffmpeg` binary rather than relying on a possibly codec-restricted
  host build.
- A presigned S3 upload integration passed against S3Mock and fresh PostgreSQL,
  including object verification, final-key move, upload completion, source
  ownership, presigned worker download, and cleanup.
- Python wheel and sdist build; `twine check` passes.
- Shared npm package builds and packs compiled ESM plus declarations.
- Prisma 7.10.1 uses driver adapters for SQLite and PostgreSQL; the migration
  chain applies to fresh SQLite and PostgreSQL databases.
- Audio-only processing is covered across schema, upload validation, worker
  extraction, transcription, context generation, source preview, and result UI.
  Visual analysis is explicitly skipped when no frames exist.
- Team workspaces, team-scoped jobs, hashed read-only share links, URL imports,
  and server-sent job events have focused unit and network acceptance coverage.
  URL import tests cover private IPv4/IPv6 ranges, mapped IPv6, credentials,
  custom ports, redirect validation, and a real CC0 image fetch.
- A held-out workflow downloaded 32 far-field AMI conversational clips and 16
  Screen2Words screenshots. A local Faster Whisper `tiny.en` pass measured
  61.83% WER and 43.81% CER; the 16 real screenshots completed fixture-provider
  ingestion and scoring. Raw and aggregate outputs are published under
  `docs/evaluation/heldout-2026-11-24/`.
- Every terminal analysis writes one idempotent usage record with configurable
  resale prices. The scheduled worker reconciles interrupted writes, and an
  authenticated operations endpoint exposes aggregate usage.
- PostgreSQL pooling is bounded through environment-controlled connection,
  idle, and acquisition settings. A repository script can preview or apply a
  Vercel WAF policy while preserving existing rules, and a weekly OWASP ZAP
  baseline workflow targets a configured staging URL.
- `render.yaml` defines a persistent worker with a durable model cache and
  graceful shutdown. It is a deployment blueprint; live-host evidence is still
  pending.
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
- `/api/health/ready` publicly returns only aggregate readiness and its
  timestamp. Per-subsystem production configuration blockers are available only
  with the operations bearer token; the endpoint returns 503 until every
  required integration is configured.
- Runtime web, worker, PostgreSQL, S3Mock, and AWS CLI images are pinned by
  digest. CI jobs have timeouts and stale-run cancellation for the web pipeline.

## Public deployment

The deployment at
[opencontext-swart.vercel.app](https://opencontext-swart.vercel.app) runs the
full upload-to-export path: GitHub OAuth, Neon PostgreSQL, S3 through a
Vercel-managed OIDC role, and a Python worker. On 2026-11-24 the public
`/api/health/ready` response returned HTTP 200 with aggregate readiness only;
the authenticated diagnostics contract is covered by the scheduled worker's
operations check.

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

The 2026-11-24 post-audit production smoke applied the upload-intent claim
migration to Neon and verified no schema drift. A temporary authenticated user
then completed a two-photo JPEG set with 18 evidence records, a derived PNG
with 8 records, and a 5.06-second downloaded CC0 video with 43 records and six
Faster Whisper transcript segments. All three Markdown/JSON exports replayed,
the scheduled worker and authenticated operations check completed, and the
temporary user and jobs were removed after verification.

The worker renews each claimed job's lease every minute so long stages do not
lose their claim between progress updates. CI verifies the heartbeat through
the non-root worker container and the Compose upload-to-export flow.

## Known gaps

- Published visual quality evidence still relies on a synthetic flow for
  measured output. The real Screen2Words screenshots exercise the larger
  workflow, but their current run uses fixture vision and is not a measured
  model-quality claim.
- The noisy-conversation result uses a local `tiny.en` model over concatenated
  far-field AMI utterance clips. Its 61.83% WER is a bounded smoke result, not a
  full-meeting or general speech benchmark.
- The live media acceptance corpus contains downloaded photographs and trailer
  footage, not a long real application walkthrough or a statistically
  representative sample of user-uploaded codecs and screen recordings.
- `opencontext-video==0.1.1` is published on PyPI and
  `@kylosonic/opencontext-schemas@0.1.1` is published on npm. Both use Trusted
  Publishing through their protected release workflows.
- `npm audit` reports zero known vulnerabilities at the time of verification;
  dependency advisories must still be rechecked on every release.
- No sustained high-traffic tuning run or independent human penetration test
  exists. The WAF policy and PostgreSQL defaults therefore remain unverified in
  production.
- A dedicated persistent worker deployment and runtime alerts have not been
  verified against a live host. Until they are, the recorded production worker
  remains the scheduled GitHub Actions drain.
- The usage ledger does not collect money or activate a metered billing
  subscription. Pricing, tax, refunds, currency, and customer mapping need an
  explicit product decision.

Scoped work is tracked in [ROADMAP.md](../ROADMAP.md) and
[docs/issues](issues/README.md).
