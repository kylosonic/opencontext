# OpenContext Codebase Architecture

Quick navigation map for engineers and coding agents working across the web
application, shared TypeScript packages, and Python media worker.

## Monorepo Layout

| Path | Responsibility |
| --- | --- |
| `packages/schemas` | Shared Zod schemas (`JobDetail`, `UPLOAD_LIMITS`, `ResultPayload`, stage payloads, error catalog) published as `@kylosonic/opencontext-schemas`. |
| `packages/config` | Environment parsing, storage selection, and auth safety rules (`@opencontext/config`). |
| `apps/web/src/lib` | Isomorphic web utilities, including canonical MIME, extension, and size-limit tables (`media-formats.ts`). |
| `apps/web/src/app` | Next.js App Router pages and HTTP API route handlers (`api/uploads`, `api/imports`, `api/jobs`, `api/workspaces`, `api/invites`, `api/scim/v2`, `api/usage`, `api/worker`, `share/[token]`). |
| `apps/web/src/components/app` | Interactive app shells: upload form (`new-job-form.tsx`, `upload-transfer.ts` with >5 MiB resumable chunks), jobs list filters (`jobs-list.tsx`), job detail (`job-detail.tsx`, `use-job-live-updates.ts`, `job-share-controls.tsx`), workspace governance/invites/roles/SCIM (`workspace-manager.tsx`, `workspace-roles-panel.tsx`, `workspace-scim-panel.tsx`, `accept-invite-card.tsx`), usage dashboard (`usage-dashboard.tsx`), URL import. |
| `apps/web/src/components/results` | Structured context viewer, timeline/transcript/OCR/evidence panels, and Markdown/JSON export downloads. |
| `apps/web/src/server/db` | Prisma client wiring (SQLite local/dev + PostgreSQL production adapter). |
| `apps/web/src/server/uploads` | Direct and resumable multipart upload intent lifecycle (`intents.ts`, `multipart.ts`) and stored-media validation/finalization (`complete.ts`). |
| `apps/web/src/server/imports` | Public URL SSRF validation (`ssrf.ts`) and bounded HTTP download pipeline (`remote.ts`). |
| `apps/web/src/server/jobs` | Job CRUD, filtered listing, rename/re-run, serialization, retry/delete lifecycle, retention policies, public share tokens, and shared source asset preview/download streaming (`sourceStream.ts`). |
| `apps/web/src/server/queue` | Database-leased job queue claim, completion, failure classification, lease renewal, and retention sweeps. |
| `apps/web/src/server/workspaces` | Team workspaces, built-in & custom RBAC (`roles.ts`), governance, hashed email invitations (`invites.ts`), SCIM 2.0 tokens & helpers (`scim.ts`), and shared job access checks. |
| `apps/web/src/server/billing` | Usage ledger recording (`UsageRecord`), reconciliation and aggregation helpers, deterministic monthly JSON/CSV draft invoice exports, and optional Stripe subscription Checkout, Billing Portal, and signed webhook synchronization. |
| `apps/web/src/server/security` | Rate limiting (`rate-limit.ts`), CSRF origin guards, and request IP/header extraction. |
| `apps/web/src/server/storage` | Pluggable local-disk and S3 object storage backends. |
| `workers/processor/src/oc_worker` | Python worker, standalone `opencontext` CLI, MCP server, and evaluation harness. |
| `workers/processor/src/oc_worker/providers` | Pluggable transcription, vision, OCR, and text providers plus shared HTTP status/retry/session handling. |
| `scripts` | Cross-language contract tests, Compose smoke checks, load tests, Vercel WAF helper, and held-out benchmark runners. |
| `docs` | Behavior specs (`docs/behaviors/`), ADRs (`docs/adr/`), deployment, security, and evaluation reports. |

## End-to-End Request & Processing Flow

```text
1. Ingestion
   ├─ Direct Upload: POST /api/uploads -> PUT (S3 presign or /api/uploads/[id]/body)
   │                 -> POST /api/uploads/[id]/complete (or batch/complete)
   └─ URL Import:    POST /api/imports/url -> ssrf.resolvePublicHost -> remote.openPublicUrl
                     -> boundedStream -> upload intent + completeUpload -> Queued Job

2. Queue & Worker Processing
   Worker main.py -> POST /api/worker/jobs/claim (leased in apps/web/src/server/queue/claimJob.ts)
     Web queue commit -> optional GitHub `repository_dispatch` (`job-queued`)
       -> worker-schedule.yml serialized concurrency group -> immediate drain
     └─ Pipeline.run_job (workers/processor/src/oc_worker/pipeline.py)
          ├─ EXTRACTING         (ffmpeg probe/audio/frames, pdfium pages, image normalization)
          ├─ TRANSCRIBING       (audio_chunks + whisper/openai/fixture providers)
          ├─ ANALYZING          (vision + independent OCR providers, concurrency bounded)
          ├─ AGGREGATING        (scene timeline clustering, frame stride helpers)
          └─ GENERATING_CONTEXT (JSON context + Markdown template/LLM refinement)
        -> POST /api/worker/jobs/[id]/complete (or /fail) + UsageRecord ledger write

3. Live Updates, Review & Sharing
   ├─ Browser JobDetailClient -> use-job-live-updates (EventSource /api/jobs/[id]/events + 3s poll fallback)
   ├─ Evidence review -> PATCH /api/jobs/[id]/evidence/[evidenceId]
   ├─ Source preview -> GET /api/jobs/[id]/source (via jobs/sourceStream.ts)
   └─ Public share -> POST /api/jobs/[id]/share -> /share/[token] & /share/[token]/source
```

### Untrusted media extraction boundary

Downloaded media is treated as hostile input before any parser sees it. On
POSIX, FFmpeg and ffprobe receive the source through one inherited, seekable
file descriptor and allow only FFmpeg's `fd` protocol. Nested concat, HLS, or
DASH manifests therefore cannot open arbitrary `file:` paths or network URLs.
The Windows fallback keeps FFmpeg safe mode enabled and uses `file,pipe`
because `pass_fds` is unavailable.

Every FFmpeg/ffprobe command runs in a new process group through a pre-exec
resource shim. The child receives a scrubbed environment, an empty temporary
working directory, closed non-source descriptors, and limits for CPU, address
space, output size, processes, open files, and core dumps. A hard wall-clock
timeout kills the complete process group. PDFium and Tesseract OCR use the same
boundary; PDFium runs in a dedicated helper process so a malformed document can
be terminated without taking down the worker supervisor.

Container hosts add a second boundary: the worker runs as UID 10001 with a
read-only root filesystem, dropped Linux capabilities, `no-new-privileges`,
bounded pids/memory, and writable tmpfs plus the model volume only.

### Still-image normalization

PNG, JPEG, and WebP inputs share one FFmpeg normalization path. FFmpeg applies
EXIF autorotation, the long edge is bounded to 1280 pixels by default, alpha is
composited onto white, input metadata is discarded, and MJPEG output uses
bitexact flags so the muxer cannot add an encoder comment. The output is an RGB
JPEG used by vision and OCR. The web boundary rejects images over 40 megapixels
before the worker decodes them.

The real-FFmpeg suite compares all EXIF orientations 2–8 with Pillow's
orientation result, checks PNG/JPEG/WebP colours against that oracle, verifies
translucent compositing, metadata removal, output dimensions, byte determinism,
and a malformed-image corpus. CI runs the complete suite against both the
bundled FFmpeg and the pinned static FFmpeg regression binary.

### Hybrid frame sampling and de-duplication

`FRAME_SAMPLING_MODE=hybrid` lets FFmpeg keep scene changes in addition to its
interval samples. For videos in this mode, the worker then fingerprints each
normalized frame as a 64×64 RGB thumbnail plus a 64-bit difference hash derived
from a 9×8 grayscale sample. It removes an adjacent frame only when the hash is
within two bits and the RGB pixel RMS is at most 1.25. Both checks must pass.

The first and final frames are always retained. A frame that cannot be decoded
is retained and resets the comparison chain, so the optional optimization fails
open. Fixed sampling, ordered image sets, PDFs, and audio are unchanged. The
same pass runs in both the database worker pipeline and the standalone
CLI/MCP analysis path.

The measured synthetic four-slide run selected 16 raw hybrid frames, retained
five after de-duplication, preserved all slide boundaries and the final frame,
and reduced modeled vision/OCR calls by 68.75%. The reproducible method and
limits are in
[`docs/performance/frame-dedup-2026-11-26.md`](performance/frame-dedup-2026-11-26.md).

### MCP analysis boundary

The current Python MCP server is not a result-only reader. `analyze_media`,
`analyze_video`, and `analyze_image` invoke extraction and can trigger local or
opted-in remote vision, OCR, and presentation compression. The Phase 3 gate for
a replacement MCP server over existing result JSON was therefore not met, so
there is no parallel Rust or Python server. `implementation_brief`,
`context_evidence`, and `replay` remain the read-only result paths.

## Where to Make Common Changes

- **Add a supported media format or tweak size limits:** Update `UPLOAD_LIMITS` / `sourceKindForExtension` in `packages/schemas/src/job.ts` and `MIMES_BY_EXTENSION` in `apps/web/src/lib/media-formats.ts`, then run `npm run typecheck` and `npm run test:contracts`.
- **Add or update a web API endpoint:** Add the route handler under `apps/web/src/app/api/`, wrap with `withErrorHandling()`, apply `consumeRateLimit()` + `applyRateLimitHeaders()`, validate inputs with Zod from `@kylosonic/opencontext-schemas`, and gate team mutations via `getOwnedJobRow` / `canManageWorkspace`.
- **Update the database schema:** Update both `apps/web/prisma/schema.prisma` (SQLite) and `apps/web/prisma/postgres/schema.prisma` (PostgreSQL), and add matching SQL migrations under both `apps/web/prisma/migrations/` and `apps/web/prisma/postgres/migrations/`.
- **Add a Python worker AI provider:** Implement the provider interface under `workers/processor/src/oc_worker/providers/<kind>/`, register it in `providers/__init__.py` and `doctor.py`, and add unit coverage under `workers/processor/tests/`.
- **Modify the context Markdown or JSON contract:** Update `packages/schemas/src/result.ts`, `workers/processor/src/oc_worker/context.py` / `context_markdown.py`, and run `npm run test:contracts` alongside Python tests.
