# Technical Blueprint — OpenContext Slices 3–4 (DB / Queue / Storage / Jobs API / Upload / Worker)

Status: APPROVED by @architect (2026-09-02). Approved decisions: (a) combined upload+create endpoint `POST /api/jobs` (multipart); (b) Vercel serverless body cap (~4.5 MB) handled as a deployment-time decision — the API contract is host-agnostic.

TECH tickets: TECH-003, TECH-004, TECH-005, TECH-007, TECH-008, TECH-009.
Inputs: `docs/behaviors/` (jobs, upload, analysis-modes, context-output, demo,
results, identity); ADR-0001…0006; and `docs/status.md`.

## 1. Data model (Prisma, portable per ADR-0003)

Portability rules: IDs use `@default(cuid())` (no `uuid()` on SQLite); arrays use `Json` (no scalar lists on SQLite); no `SKIP LOCKED`.

```prisma
enum JobStatus { QUEUED DOWNLOADING EXTRACTING TRANSCRIBING ANALYZING AGGREGATING GENERATING_CONTEXT COMPLETED PARTIAL FAILED }
enum DetailLevel { LOW MEDIUM HIGH }
enum FailureKind { NONE TRANSIENT PERMANENT }      // PERMANENT => no retry (jobs.md B6)
enum StageName { EXTRACTING TRANSCRIBING ANALYZING AGGREGATING GENERATING_CONTEXT }
enum StageStatus { NOT_STARTED RUNNING SUCCEEDED FAILED SKIPPED }
enum MediaKind { SOURCE AUDIO FRAME }
enum Certainty { OBSERVED INFERRED UNCERTAIN }
```

- **User**: `id` (cuid), `githubId @unique`, `githubLogin`, `name?`, `avatarUrl?`, timestamps. (Auth slice 2 owns; schema ships slice 3.)
- **Job** — central row; queue fields per ADR-0001:
  - `id`, `userId` (FK cascade), `displayName` (sanitized original filename, upload.md B6), `status @default(QUEUED)`, `detailLevel @default(MEDIUM)`
  - `progress Int @default(0)` (0–100), `error String?`, `errorStage StageName?`, `failureKind @default(NONE)`, `retryCount @default(0)`
  - `stageStates Json` — `[{stage, status, attempt, startedAt?, completedAt?, error?}]` — **single authority** for stage completion (powers B4/B5 resume)
  - Queue: `claimedBy String?`, `leaseUntil DateTime?`, `availableAt DateTime?` (auto-retry backoff), `attempts Int @default(0)`
  - Source meta (ffprobe): `sourceKey`, `sourceSize`, `sourceExt`, `durationSec?`, `width?`, `height?`, `audioPresent?`, `frameCount?`
  - `createdAt`, `updatedAt`, `completedAt?` — retention: completed → `completedAt+14d`, else `createdAt+7d` (jobs.md B9); API surfaces `expiresAt`
  - Relations: `media`, `segments`, `observations`, `ocr`, `result?`
  - `DOWNLOADING` kept for master-prompt §11 conformance; uploads are server-side (ADR-0002) so no worker sets it — documented, unused.
- **Media**: `id`, `jobId`, `kind`, `key` (object ref only), `mime?`, `sizeBytes`, `timestampSec?` (frames), `width?`, `height?`, `createdAt`. One row per frame.
- **TranscriptSegment**: `id`, `jobId`, `start`, `end`, `text`, `provider?`, `createdAt`.
- **VisualObservation**: `id`, `jobId`, `frameId?`, `timestampSec`, `certainty @default(OBSERVED)`, `sceneTitle?`, `visualDescription?`, `uiElements Json`, `visibleText Json`, `interactions Json`, `layoutDescription?`, `designObservations Json`, `importantChanges Json`, `provider?`, `createdAt`. Uncertain sub-fields carry `"uncertain": true` flags.
- **OCRObservation**: `id`, `jobId`, `frameId?`, `timestampSec`, `text`, `confidence?`, `provider?`, `createdAt`.
- **ProcessingResult**: `id`, `jobId @unique`, `markdown String`, `json Json` (full structured result), `formatVersion @default(1)`, `generatedAt`, `updatedAt`. Upserted at GENERATING_CONTEXT.
- **ProviderConfiguration — deliberately NOT created.** MVP provider config is env-driven via `packages/config`; per-user provider configuration is outside the current scope. Future extension path documented.

**Retry-storage contract (B5):** stage results live in dedicated tables. Manual retry resets only FAILED/not-run stages in `stageStates`; SUCCEEDED/SKIPPED rows and tables stay untouched → worker skips them. AGGREGATING and GENERATING_CONTEXT always reset (cheap downstream consumers).

## 2. API contract

Auth classes: **session** (GitHub), **worker** (`Authorization: Bearer $WORKER_API_TOKEN`, constant-time compare), **public**. Error envelope: `{"error": {"code", "message", "stage?"}}`. Codes: `FILE_TOO_LARGE`, `FORMAT_UNSUPPORTED`, `VALIDATION_ERROR`, `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `RETRY_NOT_ALLOWED` (409), `WORKER_UNAUTHORIZED`, `INTERNAL`.

### User routes

| Method | Path | Auth | Behavior |
|---|---|---|---|
| POST | `/api/jobs` | session | multipart `file` + `detailLevel` → 201 job summary. Server-side validation (upload B1); 400/413 named reasons. |
| GET | `/api/jobs` | session | own jobs newest-first (latest 50); card fields per jobs B8; empty → `[]`. |
| GET | `/api/jobs/[id]` | session | owner → full state incl. `stageStates`, progress, error/errorStage/failureKind, detailLevel, `expiresAt` + retention text, source meta. Non-owner 403 (identity B4); deleted 404 (jobs B10); anon 401. |
| POST | `/api/jobs/[id]/retry` | session | owner; only PARTIAL or FAILED with `failureKind=TRANSIENT`; resets failed stages, clears error, status→QUEUED, `retryCount++` (B5). Else 409 `RETRY_NOT_ALLOWED`. |
| DELETE | `/api/jobs/[id]` | session | owner; delete storage objects then cascade rows (B10); 204. |
| POST | `/api/admin/retention-sweep` | worker | manual sweeper trigger (B9); idempotent; returns counts. |
| GET | `/api/demo/result` | public | deterministic pre-authored result (markdown + json + `demo: true`). |
| GET | `/api/demo/progress` | public | scripted checklist as pure function of elapsed time; no DB/queue/AI. |

### Worker routes (worker-token; mutations verify `claimedBy === workerId`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/worker/jobs/claim` | atomic claim (portable: updateMany where QUEUED and (claimedBy null or lease expired) and availableAt ≤ now; re-read + verify) → job + stageStates + source fetch info; 204 when idle |
| GET | `/api/worker/jobs/[id]/source` | `{uri, provider, sizeBytes, filename}`; S3 → presigned URL; local → streamed via `/api/worker/media/[key]` |
| POST | `/api/worker/jobs/[id]/progress` | `{stage, stageStatus, progress, message?}`; updates stageStates + progress; renews lease; idempotent |
| POST | `/api/worker/jobs/[id]/artifacts` | multipart binary (audio, frames) → `{key}` + Media rows; refs only |
| POST | `/api/worker/jobs/[id]/stage-result` | `{stage, outcome: SUCCEEDED\|FAILED\|SKIPPED, attempt, error?, data?}`; idempotent upsert per stage; EXTRACTING data = probe meta; TRANSCRIBING = segments; ANALYZING = observations + ocr; AGGREGATING = timeline payload; GENERATING_CONTEXT = markdown + json. SKIPPED reason `NO_AUDIO` (results B4) |
| POST | `/api/worker/jobs/[id]/complete` | all stages terminal → COMPLETED, `completedAt`, progress 100 |
| POST | `/api/worker/jobs/[id]/fail` | `{stage, error, failureKind, retryable}` → FAILED (permanent, B6) or PARTIAL if any stage SUCCEEDED (B4); server normalizes |

All payloads validated against shared Zod schemas in `packages/schemas` — the single cross-language contract (mirrored as JSON Schema/pydantic for Python).

## 3. Upload flow (ADR-0006 + upload.md)

- Client pre-validates (extension allowlist, ≤ 500 MB, extension required) for instant feedback; server re-validates authoritatively.
- `POST /api/uploads` validates metadata and creates a 15-minute upload intent. S3 returns a presigned `PUT`; local development returns a session-authenticated upload sink.
- `POST /api/uploads/[id]/complete` verifies ownership, stored size, and content type before creating Job + Media and moving temp → `jobs/{jobId}/source.{ext}`.
- `displayName`: strip path separators/control chars, keep the rest verbatim; rendered as text only (B6).
- One-at-a-time is client-side only (B4). No dedupe — same file twice = two jobs, unique keys (B5).
- Duration NOT checked at upload; authoritative at worker ffprobe (B2). Renamed non-video passes upload by design, fails fast in EXTRACTING (jobs B6).

## 4. Worker pipeline (`workers/processor`, Python 3.13)

Loop: idle-poll claim every 3s; concurrency 1 default (`WORKER_CONCURRENCY`, bounded). Stages sequential; each reports start/progress/result via API.

1. **EXTRACTING** — ffprobe: no video stream → permanent fail "This file is not a valid video" (B6), nothing else runs. Duration > 1800s → permanent fail "Video is longer than the 30-minute limit" (B2). Audio extract (aac); **no audio stream ⇒ `audioPresent=false`, stage SUCCEEDED, TRANSCRIBING SKIPPED with `NO_AUDIO`** (results B4 — not an error). Frames at 1 fps, JPEG, max-width 1280, each a Media row with `timestampSec` (master §12). Weight 20%.
2. **TRANSCRIBING** — `TranscriptionProvider.transcribe(audio) -> segments[]` (master §13). Providers: `openai_compatible` (HTTP, zero-dep), `faster_whisper` (optional, import-guarded). Weight 25%.
3. **ANALYZING** — `VisionProvider.analyze(frame, context) -> VisualObservation` (master §14). Providers: `openai_compatible`, `ollama`. Detail-level frame cadence (analysis-modes B1): LOW → every 10th frame, fields sceneTitle + importantChanges; MEDIUM → every 3rd frame, standard fields; HIGH → every frame + designObservations + exhaustive UI inventory. `certainty` per observation; interactions always `INFERRED`. **OCR runs inside ANALYZING** via the vision model's text extraction → OCRObservation rows with timestamps (master §15). Bounded vision concurrency (2) for cost control. Weight 35%.
4. **AGGREGATING** — pure Python, deterministic: chronological merge of segments + observations + OCR; adjacent-duplicate merge; timestamps preserved (master §16/§19). Weight 10%.
5. **GENERATING_CONTEXT** — rule/template-based developer-context builder (deterministic baseline) with optional text-provider refinement (`TEXT_PROVIDER` env); **template fallback when no provider**. Header: source name, duration, generated date, detail level; observed/inferred/uncertain markers; markdown + JSON → stage-result → complete. Weight 10%.

**Progress cadence:** stage start/end + intra-stage fractions; API computes percent from stage weights; UI polls every 3s (jobs B3).

**Retry semantics:** *transient* (timeouts/rate-limit/5xx/busy): 2 attempts within stage with backoff (2s, 8s), invisible unless exhausted (B7). *manual* (B5): API resets failed stages, same job id, completed stages skipped, aggregation+context re-run. *permanent* (B6): no retry of any kind. **Resume idempotency:** stage-result upserts, artifact upserts by kind+timestamp, expired lease → re-queue → worker re-checks server `stageStates` before running anything.

## 5. Demo design (demo.md B1–B3)

Static pre-authored module `apps/web/src/server/demo/` — `demoResult.json` (full structured result incl. markdown with "Demo Analysis" header marker) + fixed scripted stage timeline. `/api/demo/result` returns it verbatim; `/api/demo/progress` derives checklist state from wall-clock against the script. Zero dependencies: no DB, queue, storage, FFmpeg, or AI credentials. Demo page reuses results UI with `demo=true`; badge on every surface; never in any job list (B2).

## 6. File layout (slices 3–4)

```
apps/web/
  prisma/schema.prisma, prisma/migrations/
  src/server/db/prisma.ts
  src/server/queue/      claimJob.ts completeJob.ts failJob.ts requeue.ts retentionSweep.ts index.ts
  src/server/storage/    types.ts local-disk.ts s3.ts index.ts
  src/server/jobs/       createJob.ts getJob.ts listJobs.ts retryJob.ts deleteJob.ts retention.ts
  src/server/validation/ upload.ts
  src/app/api/           jobs/route.ts  jobs/[id]/route.ts  jobs/[id]/retry/route.ts
                         worker/jobs/claim/route.ts  worker/jobs/[id]/{progress,artifacts,stage-result,complete,fail}/route.ts
                         worker/media/[key]/route.ts
                         demo/{result,progress}/route.ts  admin/retention/route.ts
workers/processor/
  src/oc_worker/  main.py api_client.py pipeline.py ffmpeg.py aggregation.py context.py models.py errors.py
                  providers/{transcription,vision,text}/{base,openai_compatible,ollama}.py (+faster_whisper.py, template.py)
  tests/
packages/schemas/src/   job.ts media.ts transcript.ts observation.ts result.ts api.ts worker.ts errors.ts demo.ts
packages/config/src/    index.ts
```

Dependency direction: `web → schemas, config`; `schemas, config → nothing`; `worker → (HTTP) web API only` (ADR-0005).

## 7. Test plan (master §26)

- **Web (Vitest + SQLite integration)** `apps/web/src/server/__tests__/`: `jobs.create.test.ts`, `queue.claim.test.ts` (atomic claim, lease expiry, no double-claim), `storage.local.test.ts` + `storage.s3.test.ts` (mock S3), `upload.validation.test.ts`, `api.jobs.test.ts` (401/403/404/409/204), `retention.test.ts` (14d/7d cutoffs).
- **Worker (pytest)** `workers/processor/tests/`: `test_ffmpeg.py` (probe/frames/audio + no-audio case), `test_aggregation.py`, `test_context.py`, `test_providers.py` (openai-compatible against local stub; retry/backoff), `test_pipeline.py` (end-to-end vs stub API: happy path, PARTIAL→retry→COMPLETED reusing completed stages, permanent fail, restart-resume idempotency).
- **Synthetic fixture** (generated by tests, not committed): `ffmpeg -f lavfi -i testsrc2=duration=3:size=320x180:rate=1 -f lavfi -i sine=... -c:v libx264 -c:a aac fixture.mp4`.
- **Frontend smoke** (slice 5/13): landing, demo run, job-page polling.

## 8. Integration risks

1. **Serverless body limits** — avoided by direct presigned uploads; the web app never proxies large media bodies.
2. **TS↔Python contract drift** — `packages/schemas` canonical + JSON Schema export + contract tests both sides.
3. **SQLite/PostgreSQL portability** — Json (not scalar lists), cuid (not uuid), portable claim (no SKIP LOCKED); CI runs migrations against Postgres.
4. **Windows worker** — FFmpeg on PATH, quoting, faster-whisper wheels optional, interpreter pinning.
5. **Lease/claim races on restart** — idempotent upserts + `stageStates` re-check are the load-bearing defenses.
6. **Prod has no AI credentials** — real jobs fail with actionable stage errors (B4); demo covers the public experience (accepted per master §27).
