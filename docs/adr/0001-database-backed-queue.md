# ADR-0001: Database-backed job queue for the MVP

Status: Accepted (2026-09-02)

## Context
The master prompt prefers Redis + BullMQ. The verified environment has no Redis and no running Docker daemon. The MVP must work locally on this machine and on Vercel with minimal moving parts, while keeping the door open for Redis later.

## Decision
The MVP queue is **database-backed** using the application database (SQLite in dev, PostgreSQL in prod): enqueue inserts a job row; workers claim via an atomic lease (`claimed_by`, `lease_until`) and a portable update-if-claim-matches pattern; visibility timeout re-releases stale claims. All access goes through a single queue module. Retry counts and stage state live on the job row.

## Consequences
- Works with zero extra infrastructure in dev and prod.
- No Redis ops burden for the MVP.
- Throughput ceiling is modest — acceptable for MVP job volumes.
- The queue module is the seam: a BullMQ/Redis adapter can replace it later without touching callers (future work, not implemented).

## Rejected alternatives
- Requiring Redis now: un-runnable in the verified environment without Docker.
- In-memory queue: loses jobs on restart; violates the resumable-job requirement.
