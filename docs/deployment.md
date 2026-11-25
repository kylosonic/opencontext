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
export TRUST_PROXY='true'
export TRUST_PROXY_HOPS='1'
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
Set `TRUST_PROXY=true` only when the app is behind a reverse proxy that overwrites
or appends the address headers, and set `TRUST_PROXY_HOPS` to the number of
trusted proxy hops. A single Nginx or load-balancer hop uses the default of one.
Do not enable this for a directly exposed app whose clients can spoof those
headers. Vercel's platform headers are recognized automatically.

The application budgets 240 upload-intent requests per user per 10 minutes, so
repeated maximum-size 10-image sets do not lock the account after one upload.
Completion allows 120 requests per minute, cancellation and upload-body writes
permit 240, job retry permits 30 per job per minute, and evidence review permits
120 per job per
minute. Responses expose `X-RateLimit-*` metadata and genuine quota exhaustion
includes `Retry-After`. With `open`, a database limiter outage falls back to a
bounded in-process quota; with `closed`, it returns a service error instead of
misreporting the condition as a client 429.

After deploying, verify the secret-safe readiness report:

```bash
curl -fsS https://your-app.example/api/health/ready
```

The public response contains only `ready` and `checkedAt`. The endpoint returns
HTTP 200 only when PostgreSQL, authentication, S3 storage, the worker token, the
public HTTPS URL, and shared rate limiting are configured; otherwise it returns
HTTP 503. To see fixed per-subsystem blocker descriptions and the detected
environment, authenticate with the operations token:

```bash
curl -fsS -H "Authorization: Bearer $OPS_API_TOKEN" \
  https://your-app.example/api/health/ready
```

Detailed responses never return secret values. This is a configuration check,
not a remote connectivity test.

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

Optionally enable Google OAuth (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, callback
`/api/auth/callback/google`) or any generic Enterprise OIDC provider
(`AUTH_OIDC_ID` / `AUTH_OIDC_SECRET` / `AUTH_OIDC_ISSUER` / optional `AUTH_OIDC_NAME`,
callback `/api/auth/callback/oidc`). Workspace owners can generate SCIM 2.0
provisioning bearer tokens under `/app/teams` targeting `/api/scim/v2`.

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

On Vercel Production deployments (`VERCEL=1`, `VERCEL_ENV=production`),
`apps/web` `prebuild` automatically runs `scripts/prisma-migrate-build.mjs` to
apply pending migrations via `prisma migrate deploy` before Next.js builds.
Migrations prefer `DIRECT_URL`, then `DATABASE_URL_UNPOOLED`, then
`POSTGRES_URL_NON_POOLING`, and otherwise fall back to `DATABASE_URL` (for Neon
`-pooler` URLs, `prisma.postgres.config.ts` automatically strips `-pooler` to
connect directly so Prisma advisory locks succeed). Local builds, Docker builds
(where the runtime container executes `prisma migrate deploy` on startup), and
Vercel Preview deployments skip build-time migrations unless
`PRISMA_MIGRATE_ON_BUILD=true` is set; set `PRISMA_MIGRATE_ON_BUILD=false` to
disable automatic migrations on Vercel Production builds.

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
moving the object to its final key. Completion atomically claims each upload
intent, so duplicate or concurrent completion requests cannot create duplicate
jobs.

## Retention

The authenticated retention sweep deletes stored objects before deleting their
rows. Configure the two windows independently for the deployment's data policy:

```bash
export RETENTION_COMPLETED_DAYS='14'
export RETENTION_INCOMPLETE_DAYS='7'
```

Both values must be positive integers; invalid values fall back to the documented
defaults. The sweep is idempotent and also removes expired upload intents and
stale rate-limit buckets.

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

Provider throttles do not hold a worker for a long `Retry-After` window. When
an OpenAI-compatible model returns 429, the worker cools that model down, tries
`VISION_FALLBACK_MODELS`, and reports a transient failure if every model is
exhausted. The queue applies an escalating cooldown of up to 15 minutes and
continues with other work. Provider-limited jobs have a bounded 40-attempt
budget, separate from the five-attempt crash budget. Long videos use
`VISION_MAX_FRAMES` evenly sampled frames (default 60), and
`VISION_REQUEST_INTERVAL_SECONDS` paces calls from each worker process.

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

Worker entrypoint logging suppresses `httpx` and `httpcore` access logs because
those records include full presigned object-storage URLs. Application-level job,
stage, status, and provider-error logs remain enabled and contain no credentials.

### Operations alerts

Set `OPS_API_TOKEN` on the web app. The authenticated
`GET /api/ops/alerts` endpoint returns aggregate job counts, worker heartbeat
age, oldest queued-job age, and recent terminal failures without filenames,
media, prompts, object URLs, or secrets. It returns HTTP 503 when waiting work
has no recent worker heartbeat; queue-age and failed-job findings remain visible
as warnings in the response.

```bash
export OPS_QUEUE_AGE_MINUTES='15'
export OPS_WORKER_CLAIM_MINUTES='10'
export OPS_JOB_RUNTIME_MINUTES='30'
export OPS_FAILURE_LOOKBACK_MINUTES='60'
```

Run the alert checker from a scheduling service or server that can reach the web
app. `ALERT_WEBHOOK_URL` is optional for a report-only check, but production
alerting needs a receiver for the JSON event:

```bash
export OPENCONTEXT_BASE_URL='https://your-app.example'
export OPS_API_TOKEN='a-separate-long-random-secret'
export ALERT_WEBHOOK_URL='https://your-alert-receiver.example/opencontext'
node scripts/check-operations.mjs
```

The scheduled GitHub worker runs the same check after its drain. Add
`OPS_API_TOKEN` and, for an actual notification, `ALERT_WEBHOOK_URL` as GitHub
Actions secrets. A missing receiver is reported; an alert is never silently
treated as a successful notification.

### Hosted worker options

A long-running background worker on Render, Railway, Fly.io, or a container
platform is the recommended production setup because it claims jobs
immediately. The repository ships `docker/worker-hosted.Dockerfile` for that
purpose; see `docker/worker-hosted.env.example` for the environment contract.

You can deploy the web app and worker together on a Docker-capable host with
the deployment definition at `docker/compose.hosted.yml`. The default bundle
contains PostgreSQL, the web app, and the worker; S3-compatible object storage
remains an external service. Run it from the repository root after configuring
the required production variables:

```bash
docker compose -f docker/compose.hosted.yml up -d --build
```

That stack uses PostgreSQL for the queue and the public GitHub OAuth settings.
Set `STORAGE_S3_*`, `APP_BASE_URL`, `AUTH_GITHUB_*`, `AUTH_SECRET`, and
`WORKER_API_TOKEN`, `OPS_API_TOKEN`, and at least one supported AI provider key
before starting it. The worker model cache is a named volume owned by UID 10001,
and both containers receive `SIGTERM` and drain before stopping. The Compose
stack trusts its own request Host header so Auth.js can construct callback URLs;
set `AUTH_TRUST_HOST=false` only when another proxy validates that header.
`OPENCONTEXT_WEB_PORT` only changes the host publishing port; set `APP_BASE_URL`
to the URL that users will actually visit.

For a local acceptance run without external object storage, add
`--profile local-storage`; this starts S3Mock and creates the configured bucket
before the web service. The S3 service and bucket-initializer are not started by
the default production definition.

`docker/web-hosted.Dockerfile` produces the PostgreSQL-only web image. It runs
pending migrations on start, removes unused SQLite packages, excludes local env
files, and exposes the public readiness check for the host health check. It does
not rewrite the Prisma schema at container start. Vercel's serverless project
remains a valid public web deployment, but it does not itself supply a
persistent queue worker.

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

The worker health check validates its AI provider configuration without making
a provider request. The default environment uses the fixture vision provider
and local Faster Whisper. The optional real-vision path is selected with
`npm run compose:demo -- real`, which requires:

```text
OPENCONTEXT_DEMO_MODEL=<image-capable model>
OPENAI_BASE_URL=<OpenAI-compatible endpoint>
OPENAI_API_KEY=<provider key>       # or OPENCODE_API_KEY
```

For Gemini, supply `GEMINI_API_KEY`. `OPENCONTEXT_DEMO_MODEL` defaults to
`gemini-4-hydrogen` and can be set to another model available to the project.
`GEMINI_BASE_URL` defaults to the Generative Language API v1beta endpoint. This
selects native Gemini image analysis; text generation continues to use the local
template provider.

The launcher runs a container configuration check before starting the stack.
It binds the configured model to the vision and text provider and disables
transcription for this image-focused demo so an audio endpoint is unnecessary.
It does not print keys. The `.env.local` file used for local credentials is
ignored by Git. Do not add secrets to `docker-compose.yml`.

Real vision makes an external network request and can incur provider charges.
The documented reference image is generated, contains no personal or payment
account data, and is stored at `docs/assets/real-vision-checkout.png`. Use
`docs/issues/02-real-vision-smoke.md` for the provider-only smoke check. The
Compose upload test can use the same reference image in an explicit
`OPENCONTEXT_DEMO_VISION=real` run:

```bash
OPENCONTEXT_DEMO_VISION=real node scripts/compose-smoke.mjs
```

The default network-free Checks still use fixture mode and require no
credentials.

## Persistent worker blueprint

The repository includes `render.yaml`, which defines a Render background-worker
service built from `docker/worker-hosted.Dockerfile`. It keeps the Faster
Whisper cache on a 5 GB persistent disk mounted at `/models`, drains on
`SIGTERM`, and reads `WORKER_API_URL`, `WORKER_API_TOKEN`, and
`OPENAI_API_KEY` from Render secrets.

Before applying the blueprint, set those three secrets and confirm the selected
plan supports background workers and persistent disks. After the first deploy,
verify:

```bash
curl -fsS "$WORKER_API_URL/api/health/ready"
# Upload one synthetic job, then confirm the first progress update arrives
# without waiting for the five-minute GitHub Actions schedule.
curl -fsS -H "Authorization: Bearer $OPS_API_TOKEN" \
  "$WORKER_API_URL/api/ops/alerts"
```

Stop or disable `.github/workflows/worker-schedule.yml` only after the
persistent worker has claimed a real job, survived a redeploy, and passed the
authenticated operations check. Keeping both workers enabled is safe because
claims are lease-fenced, but the scheduled worker may then idle.

## PostgreSQL pools

The PostgreSQL adapter accepts `DB_POOL_MAX`,
`DB_POOL_IDLE_TIMEOUT_MS`, and `DB_POOL_CONNECTION_TIMEOUT_MS`. Vercel defaults
to three connections per process; persistent containers default to ten. Use a
provider-provided pooled URL for serverless deployments and set
`DB_POOL_MAX` from `provider_connection_limit / maximum_concurrent_instances`,
not from the database's raw connection limit. Leave enough capacity for
migrations and the worker API.

## Edge WAF

Application limits remain authoritative for user and worker quotas. Before
enabling edge rate limits, run a representative staging load and inspect
Vercel Firewall events. Preview the repository policy without changing the
project:

```bash
VERCEL_TOKEN=... VERCEL_PROJECT_ID=... \
  node scripts/configure-vercel-waf.mjs
```

The preview enables managed scanner, multipart, file-inclusion, execution, XSS,
SQL-injection, and session-fixation protections. It also upserts conservative
per-address limits for auth, URL import, and worker paths while preserving
existing rules. After reviewing the diff and thresholds, apply it explicitly:

```bash
VERCEL_TOKEN=... VERCEL_PROJECT_ID=... \
  node scripts/configure-vercel-waf.mjs --apply
```

Record the Vercel configuration version, traffic window, challenge/deny counts,
and false-positive review in the operations log. Re-run after substantial
traffic changes.

## Teams, sharing, and URL imports

Team membership grants read access to jobs explicitly uploaded to that team.
The creator, team owner, or team admin may delete or retry a team job. Team
invitations currently target users who have already signed in, by email or
GitHub login; email delivery and domain auto-join are not included.

Public sharing creates a 256-bit random bearer token, stores only its SHA-256
hash, expires after 30 days, and can be rotated or revoked. Shared pages omit
download, review-edit, retry, and delete controls.

URL imports accept only HTTP(S), reject credentials/custom ports/private DNS
answers, pin the validated address during each request, revalidate every
redirect, require `Content-Length`, cap bytes by media type, and then run the
same stored-content validation as browser uploads. Serverless function duration
limits still bound very large downloads; use direct browser upload when a
remote server is slow or omits `Content-Length`.

## Usage and rebilling ledger

Every terminal analysis writes one idempotent `UsageRecord`. Prices remain zero
unless `BILLING_ANALYSIS_MICROS_PER_SECOND` or
`BILLING_STILL_JOB_MICROS` is configured. The scheduled worker reconciles any
terminal job whose best-effort ledger write was interrupted.

Operations can inspect aggregate usage with the operations token:

```bash
curl -fsS -H "Authorization: Bearer $OPS_API_TOKEN" \
  "$APP_BASE_URL/api/ops/usage?since=2026-11-01T00:00:00Z"
```

This is the billing-system boundary, not a payment processor. Before automated
charging, choose the billing provider, configure tax/currency/refund policy,
map customers to subscriptions, publish prices, and reconcile the exported
events. Do not represent the zero-priced default ledger as active billing.
