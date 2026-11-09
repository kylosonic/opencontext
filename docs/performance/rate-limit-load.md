# PostgreSQL rate limiter load test

This test verifies that separate application processes share one fixed-window
quota through PostgreSQL. It exercises the production rate-limit module in six
independent Node processes with two PostgreSQL connections per process.

## Result

Run date: 2026-11-09

- 6 independent processes
- 25 simultaneous requests per process
- 4 rounds, for 600 total requests against fresh keys
- Quota of 37 requests per 60-second window
- Exactly 37 requests allowed and 113 blocked in every round
- Exactly 37 consumed slots persisted for every key
- 8.89 seconds for the four synchronized rounds, about 67.5 attempts/second
- Highest observed per-process batch latency: 3.84 seconds

Raw output:
[rate-limit-load-2026-11-09.json](rate-limit-load-2026-11-09.json).

## Method

The load runner bundles the real
[`consumeRateLimit`](../../apps/web/src/server/security/rate-limit.ts) module
once and launches six lightweight Node processes. Each process creates its own
Prisma client and uses `connection_limit=2`. The runner waits for every
process to initialize, then sends a synchronized 150-request burst using one
shared key and timestamp.

After each burst, a process reads the persisted `RateLimitBucket` row. The run
fails unless both conditions hold:

1. exactly the configured quota is allowed across all processes;
2. the database contains exactly the same count.

The run uses `RATE_LIMIT_FAILURE_MODE=closed` so a database failure cannot
silently turn into an allowed request during the measurement.

## Reproduction

Point `DATABASE_URL` at a disposable PostgreSQL database, generate and apply
the PostgreSQL schema, then run:

```bash
export DATABASE_URL='postgresql://opencontext:opencontext@localhost:5432/opencontext?schema=public'
export RATE_LIMIT_LOAD_ALLOW_RESET=1

npm run prisma:generate:postgres --workspace web
npm run prisma:migrate:deploy:postgres --workspace web
npm run test:rate-limit-load -- \
  --instances 6 \
  --requests 25 \
  --limit 37 \
  --rounds 4 \
  --out .artifacts/rate-limit-load.json

# Restore the default SQLite client before local web tests.
npm run postinstall --workspace web
```

The confirmation variable is required because the test clears rate-limit rows
in the selected database.

## Limits

This is a correctness probe across independent processes, not a capacity
benchmark for the full HTTP application. It uses one local PostgreSQL
container, artificial connection pools of two per process, and synchronized
traffic. Latency numbers vary with hardware, database placement, and
connection limits. A production capacity claim still requires sustained load
against the deployed web service and its real connection pool.
