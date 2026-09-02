# ADR-0004: Storage abstraction — local disk / S3-compatible

Status: Accepted (2026-09-02)

## Context
Master prompt requires an abstraction supporting S3 and Cloudflare R2. No object storage is configured in the current environment.

## Decision
One storage interface with two providers selected by env: **local disk** (default, dev) and **S3-compatible** (production, e.g., R2). All reads/writes of media and artifacts go through the interface; nothing else touches the filesystem or buckets.

## Consequences
- Media never stored in the database; only references (per master prompt §22).
- Local dev works immediately; production is config-only.
- Retention and deletion (behaviors `jobs.md` B9/B10) are implemented against the interface.

## Rejected alternatives
- MinIO in dev: Docker unavailable.
- Direct filesystem coupling: blocks the S3 production path.
