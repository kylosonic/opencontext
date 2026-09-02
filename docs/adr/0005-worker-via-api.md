# ADR-0005: Worker communicates with the web API over HTTP

Status: Accepted (2026-09-02)

## Context
The Python worker needs job data and must report progress/results. Direct database access from Python would duplicate schema knowledge and credentials.

## Decision
The worker is a **client of the web API**: it claims jobs, fetches source media (path or presigned URI), and reports stage progress, artifacts, partial results, and failures through authenticated worker endpoints (`WORKER_API_TOKEN` shared secret). The worker has **no direct database access**.

## Consequences
- Single source of truth for data: the TypeScript/Prisma layer.
- Worker deploys anywhere with network access (no DB reachability, no VPC requirements).
- Worker endpoints must be protected (security gate covers this).
- All job state transitions stay consistent, including PARTIAL and resume semantics (behaviors `jobs.md` B4/B5).
