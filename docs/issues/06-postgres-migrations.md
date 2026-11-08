# Add provider-specific PostgreSQL migrations

## Problem

Local Prisma migrations are SQLite SQL. The deployed PostgreSQL stack currently
uses `db push`, which is acceptable for bootstrap but not a long-lived schema
history.

## Scope

- Establish a Postgres migration baseline from the current schema.
- Add a documented command for generating and reviewing migrations.
- Check migration drift in CI against Postgres.
- Keep SQLite test setup fast.

## Acceptance

- [ ] Fresh Postgres applies migrations without `db push`.
- [ ] CI fails when schema and migrations drift.
- [ ] SQLite test database setup remains supported.
- [ ] Deployment guide switches to `prisma migrate deploy`.

## Files

- `apps/web/prisma/`
- `scripts/prisma-schema.mjs`
- `.github/workflows/ci.yml`
- `docs/deployment.md`

## Verify

```bash
npm run prisma:generate:postgres --workspace web
npx prisma migrate deploy --schema apps/web/prisma/.generated/schema.prisma
```
