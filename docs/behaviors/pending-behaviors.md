# Pending behaviors — post-MVP roadmap backlog

Status: FUTURE — NOT YET IMPLEMENTED

Nothing in this file is a commitment until designed and verified. Items already implemented since the initial MVP have moved out of this backlog into the live codebase and docs.

## Implemented since MVP

These previously deferred capabilities are now implemented (`apps/web/src/app/docs/` and `docs/status.md`):

- **Job sharing / public links** — Expiring, revocable read-only snapshots at `/share/[token]` (`GET/POST/DELETE /api/jobs/[id]/share`).
- **URL ingestion** — SSRF-guarded remote public HTTP(S) media import (`POST /api/imports/url`).
- **Audio-only analysis** — Standalone audio uploads and transcription pipeline for MP3, M4A, WAV, OGG, AAC, and FLAC.
- **Collaborative workspaces & email invitations** — Team workspaces, governance (`OWNER` / `ADMIN` / `MEMBER` / `VIEWER`), and hashed 7-day email invitation links (`GET/POST /api/workspaces`, `/api/workspaces/[id]/invites`, `/api/invites/[token]`).
- **Job renaming & detail-level re-runs** — Inline job renaming (`PATCH /api/jobs/[id]`), re-running finished jobs with copied source media at a new detail level (`POST /api/jobs/[id]/rerun`), and searchable job/usage dashboards.
- **Hybrid scene-change detection** — Optional adaptive FFmpeg scene-cut + interval frame sampling via `--sampling-mode hybrid` / `FRAME_SAMPLING_MODE=hybrid`.
- **Conservative video frame de-duplication** — In hybrid mode, removes only near-identical adjacent frames after sampling, preserves first/final frames, and fails open on fingerprint errors.
- **Resumable chunked uploads & original downloads** — Multipart uploads for files over 5 MiB (`POST /api/uploads/multipart`, `/api/uploads/[id]/chunks/[partNumber]`, `/api/uploads/[id]/status`) with browser resume state, plus authenticated original file downloads (`GET /api/jobs/[id]/source?download=1`).
- **Google OAuth, generic OIDC SSO, custom workspace roles & SCIM 2.0** — Multi-provider Auth.js v5 (`AUTH_GOOGLE_*`, `AUTH_OIDC_*`), fine-grained workspace permission roles (`/api/workspaces/[id]/roles`), and workspace-scoped SCIM 2.0 user/group sync (`/api/scim/v2`).
- **Context compression, plugin system & local GPU inference** — Redundancy merging and token-budget capping (`compression.py`), `WorkerPlugin` frame/context hooks (`plugins.py` + `opencontext plugins list`), CUDA/hardware detection (`hardware.py`), and `docker/worker.gpu.Dockerfile`.
- **Real-time status channels** — Server-Sent Events stream at `/api/jobs/[id]/events` with automatic polling fallback.
- **GitHub Actions agent integration** — Root composite action for repository-local analysis, Markdown/JSON context, and implementation briefs; `uvx` provides an ephemeral CLI path from the existing PyPI release.

## Still unimplemented

1. **Additional agent-specific integrations** beyond MCP and GitHub Actions, such as hosted SDK-specific wrappers or chat-platform connectors.
2. **Additional CLI distribution channels** beyond PyPI/`uvx`, such as signed standalone binaries or package-manager formulas.
3. **Real-time streaming processing.**
4. **Metered billing checkout** — self-service usage aggregation (`/app/usage`), idempotent recording, monthly JSON/CSV draft exports, and optional Stripe subscription Checkout/Billing Portal exist. Automatic metered usage submission, tax, final invoicing, and refund policy remain pending.
