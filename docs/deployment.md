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

For any S3-compatible endpoint (Cloudflare R2, MinIO, S3Mock) use the static
credential variables above. On Vercel, an AWS Marketplace integration can
assume an IAM role through Vercel OIDC instead, which avoids long-lived AWS
keys. Install the AWS integration from the Vercel Marketplace, then set:

```bash
export AWS_ROLE_ARN='arn:aws:iam::123456789012:role/your-vercel-oidc-role'
export AWS_REGION='us-east-1'
export S3_BUCKET_NAME='opencontext-media'
```

Leave the five `STORAGE_S3_*` variables unset when using OIDC. The web app
selects OIDC automatically when static variables are absent and these three
are present. OIDC is Vercel-only; other hosts need static credentials.

Use `RATE_LIMIT_BACKEND=database` when more than one web instance can serve the
same users. Choose `RATE_LIMIT_FAILURE_MODE=closed` when rejecting traffic
during a limiter outage is safer for your deployment than allowing it.

After deploying, verify the secret-safe readiness report:

```bash
curl -fsS https://your-app.example/api/health/ready
```

The endpoint returns HTTP 200 only when PostgreSQL, authentication, S3 storage,
the worker token, the public HTTPS URL, and shared rate limiting are configured.
It returns HTTP 503 with fixed blocker descriptions and never returns secret
values. This is a configuration check, not a remote connectivity test.

The repository includes a multi-process PostgreSQL contention test. Against a
disposable database:

```bash
export DATABASE_URL='postgresql://opencontext:opencontext@localhost:5432/opencontext?schema=public'
export RATE_LIMIT_LOAD_ALLOW_RESET=1
npm run prisma:generate:postgres --workspace web
npm run prisma:migrate:deploy:postgres --workspace web
npm run test:rate-limit-load -- --out .artifacts/rate-limit-load.json
npm run postinstall --workspace web
```

See [docs/performance/rate-limit-load.md](performance/rate-limit-load.md) for
the published result, test design, and limitations. It verifies quota
consistency; it is not a replacement for sustained load testing against the
deployed service.

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

Use `TRANSCRIPTION_PROVIDER=openai_audio` with an audio-capable
OpenAI-compatible chat model when provider-side audio understanding is
preferred. This mode sends the extracted WAV in one chat request and is best
suited to bounded recordings. The default local Faster Whisper provider remains
appropriate for long media.

Use a process supervisor or container restart policy. Run one worker with
`--once` for cron-style execution or long-running workers with
`WORKER_CONCURRENCY` set to the host capacity.

The worker entrypoint is a long-running supervisor. On `SIGTERM` or `SIGINT`,
it stops claiming new work and waits for the active job before exiting.
`WORKER_SHUTDOWN_GRACE_SECONDS` bounds that drain (default 120 seconds); the
container host should allow a slightly longer stop period. Claim errors back
off for `WORKER_ERROR_BACKOFF_SECONDS` (default 5 seconds).

Every job has a `WORKER_JOB_TIMEOUT_SECONDS` processing deadline (default 900
seconds, also configurable with `--job-timeout-seconds`). A timeout records a
permanent worker failure instead of leaving the job processing indefinitely.
The deadline complements provider request timeouts and host container limits.
Heap memory and CPU quotas are host policy; they cannot be enforced portably
inside the existing worker process.

The worker renews each claimed job's lease every minute, independently of
stage progress reports. If the API is temporarily unavailable, it retries the
heartbeat on the next interval. A terminated worker stops renewing, so the job
becomes claimable again after the five-minute lease expires. Completed stage
results and artifacts remain resumable after a restart.

The worker image runs as UID 10001 with `HF_HOME=/models`. Mount a persistent
volume at `/models` to retain downloaded transcription models across restarts.
The image forwards `SIGTERM` directly. Configure the host to restart the
container on failure and set memory and CPU quotas appropriate for the selected
providers.

### Hosted worker options

A long-running background worker on Render, Railway, Fly.io, or a container
platform is the recommended production setup because it claims jobs
immediately. The repository ships `docker/worker-hosted.Dockerfile` for that
purpose; see `docker/worker-hosted.env.example` for the environment contract.

You can deploy the web app and worker together on a Docker-capable host with
the deployment definition at `docker/compose.hosted.yml`. The bundle contains
PostgreSQL, the web app, and the worker; S3-compatible object storage remains an
external service. Run it from the repository root after configuring the
required production variables:

```bash
docker compose -f docker/compose.hosted.yml up -d --build
```

That stack uses PostgreSQL for the queue and the public GitHub OAuth settings.
Set `STORAGE_S3_*`, `APP_BASE_URL`, `AUTH_GITHUB_*`, `AUTH_SECRET`, and
`WORKER_API_TOKEN` before starting it. The worker model cache is a named volume
owned by UID 10001, and both containers receive `SIGTERM` and drain before
stopping. `OPENCONTEXT_WEB_PORT` only changes the host publishing port; set
`APP_BASE_URL` to the URL that users will actually visit.

`docker/web-hosted.Dockerfile` produces the PostgreSQL-only web image. It runs
pending migrations on start, drops unused SQLite support, excludes local env
files, and exposes `/api/health/ready` for the host health check. Vercel's
serverless project remains a valid public web deployment, but it does not itself
supply a persistent queue worker.

The GitHub Actions schedule remains the fallback when no always-on worker host
is configured.

If you do not have a long-running host yet, `.github/workflows/worker-schedule.yml`
drains the queue from GitHub Actions every five minutes. It is a real worker,
not a simulation, but job start latency is up to one cron interval. Set these
repository secrets and variables before enabling it:

```bash
gh secret set WORKER_API_TOKEN --body "$WORKER_API_TOKEN"
gh secret set OPENAI_API_KEY --body "$OPENAI_API_KEY"
gh variable set WORKER_API_URL --body "https://your-app.example"
```

The workflow installs Faster Whisper and caches the model between runs. It uses
`TEXT_PROVIDER=template`, so context generation needs no extra provider.

## Compose

`docker compose up --build` provides a local PostgreSQL-backed web app, worker,
and local-only sign-in. It is a development stack, not a production hardening
recipe. See `docs/security-review.md` before exposing any instance publicly.
