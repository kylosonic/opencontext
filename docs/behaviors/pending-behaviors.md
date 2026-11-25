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
- **Real-time status channels** — Server-Sent Events stream at `/api/jobs/[id]/events` with automatic polling fallback.

## Still unimplemented

1. **Resumable chunked uploads** — uploads currently restart interrupted transfers from zero.
2. **Download original video** — assumes the user still holds the original source file.
3. **Additional agent-specific integrations** beyond the implemented local MCP server.
4. **Additional CLI distribution channels** beyond the implemented Python CLI.
5. **Real-time processing.**
6. **Local GPU inference** guidance and setup flows.
7. **Plugin system.**
8. **Non-GitHub identity providers** and org-level SSO / SCIM.
9. **Context compression** beyond MVP-level merging/dedup of adjacent observations.
10. **Metered billing checkout** — self-service usage aggregation (`/app/usage`) and idempotent recording exist, while payment provider, tax, and invoice collection remain pending.
