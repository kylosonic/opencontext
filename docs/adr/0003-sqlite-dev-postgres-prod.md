# ADR-0003: SQLite for local dev, PostgreSQL for production

Status: Accepted (2026-09-02)

## Context
Docker daemon is not running in the verified environment, so docker-compose PostgreSQL is not available now. Production requires PostgreSQL (per master prompt).

## Decision
Prisma with a **portable schema** (no PostgreSQL-only column types where avoidable). `DATABASE_URL` selects the engine: SQLite file in local dev, PostgreSQL in production. Migrations are Prisma migrations; a compatibility check runs in CI against PostgreSQL.

## Consequences
- Local dev runs with zero infrastructure.
- Schema portability constrains type usage (acceptable for MVP).
- Queue (ADR-0001) uses the portable claim pattern, avoiding `SKIP LOCKED`.
- Production uses the preferred PostgreSQL per the master prompt.
