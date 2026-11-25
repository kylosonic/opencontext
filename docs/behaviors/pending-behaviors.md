# Pending behaviors — post-MVP roadmap backlog

Status: FUTURE — NOT YET IMPLEMENTED

Nothing in this file is a commitment until designed and verified. Items already implemented since the initial MVP have moved out of this backlog into the live codebase and docs.

## Implemented since MVP

These previously deferred capabilities are now implemented (`apps/web/src/app/docs/` and `docs/status.md`):

- **Job sharing / public links** — Expiring, revocable read-only snapshots at `/share/[token]` (`GET/POST/DELETE /api/jobs/[id]/share`).
- **URL ingestion** — SSRF-guarded remote public HTTP(S) media import (`POST /api/imports/url`).
- **Audio-only analysis** — Standalone audio uploads and transcription pipeline for MP3, M4A, WAV, OGG, AAC, and FLAC.
- **Collaborative workspaces** — Team workspaces and membership roles (`GET/POST /api/workspaces`, `/api/workspaces/[id]/members`).
- **Real-time status channels** — Server-Sent Events stream at `/api/jobs/[id]/events` with automatic polling fallback.

## Still unimplemented

1. **Resumable chunked uploads** — uploads currently restart interrupted transfers from zero.
2. **Job renaming** — jobs currently keep their source display name after creation.
3. **Re-run a job at a different detail level** — re-running currently requires submitting a new upload.
4. **Download original video** — assumes the user still holds the original source file.
5. **Scene-change detection** replacing fixed frame sampling.
6. **Additional agent-specific integrations** beyond the implemented local MCP server.
7. **Additional CLI distribution channels** beyond the implemented Python CLI.
8. **Real-time processing.**
9. **Local GPU inference** guidance and setup flows.
10. **Plugin system.**
11. **Non-GitHub identity providers.**
12. **Context compression** beyond MVP-level merging/dedup of adjacent observations.
13. **Team billing and metered checkout** — idempotent usage recording exists, while payment provider, pricing, tax, and email invitations / granular roles remain pending.
