# Deployment Guide

## Web application

Use a persistent PostgreSQL database and S3-compatible object storage.

```bash
export DATABASE_URL='postgresql://user:password@host:5432/opencontext'
export AUTH_SECRET='a-long-random-secret'
export AUTH_GITHUB_ID='...'
export AUTH_GITHUB_SECRET='...'
export STORAGE_PROVIDER='s3'
export STORAGE_S3_ENDPOINT='https://...'
export STORAGE_S3_REGION='...'
export STORAGE_S3_BUCKET='opencontext-media'
export STORAGE_S3_ACCESS_KEY_ID='...'
export STORAGE_S3_SECRET_ACCESS_KEY='...'
export WORKER_API_TOKEN='a-separate-long-random-secret'
export APP_BASE_URL='https://your-app.example'
export RATE_LIMIT_BACKEND='database'
export RATE_LIMIT_FAILURE_MODE='open'
```

Use `RATE_LIMIT_BACKEND=database` when more than one web instance can serve the
same users. Choose `RATE_LIMIT_FAILURE_MODE=closed` when rejecting traffic
during a limiter outage is safer for your deployment than allowing it.

Create the GitHub OAuth app with the callback URL:

`https://your-app.example/api/auth/callback/github`

Generate the PostgreSQL Prisma client and apply the schema:

```bash
npm run prisma:generate:postgres --workspace web
npm run prisma:migrate:deploy:postgres --workspace web
npm run build
npm run start --workspace web
```

Prisma 7 reads the database URL from `apps/web/prisma.config.ts` for SQLite and
`apps/web/prisma.postgres.config.ts` for PostgreSQL. The web runtime selects the
`better-sqlite3` or `pg` driver adapter from the `DATABASE_URL` scheme; no
native Prisma query engine is required.

PostgreSQL migrations live in `apps/web/prisma/postgres/migrations`. Generate
and review a new migration before deploying schema changes. An existing
database that was created with the old `db push` path needs its schema
baselined separately before `migrate deploy`; new databases apply the checked-in
baseline automatically.

For a schema change, point `DATABASE_URL` at a disposable PostgreSQL database
and generate the named migration from the checked-in PostgreSQL schema:

```bash
cd apps/web
npx prisma migrate dev --config prisma.postgres.config.ts --name describe_change
```

Commit and review the generated SQL. CI applies the migration chain to a fresh
PostgreSQL service and fails if the resulting database differs from the schema.

## Object storage

The bucket must allow browser `PUT` requests from the web origin and expose
`Content-Type`. A minimal CORS rule is:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep the bucket private. The worker reads source media through a short-lived
presigned GET URL. Upload completion verifies size and content type before
moving the object to its final key.

For the real S3-compatible integration test, start the test-only S3Mock profile
and run the web suite with the matching environment:

```bash
docker compose --profile storage-test up -d s3mock
export OPENCONTEXT_S3_E2E=1
export STORAGE_S3_ENDPOINT=http://127.0.0.1:9090
export STORAGE_S3_REGION=us-east-1
export STORAGE_S3_BUCKET=opencontext-test
export STORAGE_S3_ACCESS_KEY_ID=test
export STORAGE_S3_SECRET_ACCESS_KEY=test
npm test --workspace web
```

The opt-in test creates the bucket, generates a short video, performs a
presigned upload, verifies the object, completes the job, and downloads the
source through a presigned worker URL. S3Mock does not implement
`PutBucketCors`; configure and verify production CORS separately. The test is
skipped when `OPENCONTEXT_S3_E2E` is not `1`.

## Worker

The worker needs FFmpeg, Python 3.13+, network access to the web API and any
model providers, and the same `WORKER_API_TOKEN`.

```bash
cd workers/processor
python -m venv .venv
.venv/bin/python -m pip install -e ".[local]"
export WORKER_API_URL='https://your-app.example'
export WORKER_API_TOKEN='the-same-worker-token'
export TRANSCRIPTION_PROVIDER='faster_whisper'
export TRANSCRIPTION_MODEL='base'
export VISION_PROVIDER='ollama'
export OLLAMA_BASE_URL='http://localhost:11434'
export TEXT_PROVIDER='template'
.venv/bin/python -m oc_worker.main
```

Use a process supervisor or container restart policy. Run one worker with
`--once` for cron-style execution or long-running workers with
`WORKER_CONCURRENCY` set to the host capacity.

## Compose

`docker compose up --build` provides a local PostgreSQL-backed web app, worker,
and local-only sign-in. It is a development stack, not a production hardening
recipe. See `docs/security-review.md` before exposing any instance publicly.
