# Pending behaviors — explicitly NOT in the MVP

Status: FUTURE — NOT IMPLEMENTED

Nothing in this file is a commitment for the MVP. Items move into the behavior files above only after a deliberate decision, through the same grilling process.

1. **Resumable chunked uploads** — the MVP restarts interrupted uploads from zero.
2. **Job sharing / public links** — MVP jobs are owner-only.
3. **Job renaming** — the MVP names jobs by original filename.
4. **Re-run a job at a different detail level** — the MVP requires a new job.
5. **Download original video** — the MVP assumes the user has the source.
6. **URL ingestion** (e.g., YouTube) — explicitly optional per the master prompt.
7. **Image, PDF, and audio-only analysis** — MVP handles video only.
8. **Scene-change detection** replacing fixed frame sampling.
9. **Additional agent-specific integrations** beyond the implemented local MCP
   server.
10. **Additional CLI distribution channels** beyond the implemented Python CLI.
11. **Real-time processing.**
12. **Local GPU inference** guidance and setup flows.
13. **Plugin system.**
14. **Collaborative workspaces.**
15. **Real-time status channels** — the MVP uses polling.
16. **Non-GitHub identity providers.**
17. **Context compression** beyond MVP-level merging/dedup of adjacent observations.
18. **Team features of any kind** — billing, roles, permissions.
