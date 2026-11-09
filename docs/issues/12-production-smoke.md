# Add a production deployment smoke test

## Problem

Production GitHub OAuth, PostgreSQL, object storage, and a worker are documented
but not configured as a complete deployed service.

## Scope

- Deploy the web app and worker to the selected hosts.
- Configure GitHub OAuth, durable PostgreSQL, object storage, and secrets.
- Upload a short generated video through the deployed UI.
- Verify evidence-linked exports and owner-only access.

## Acceptance

- [x] A signed-in user can upload and receive a completed job.
- [x] A non-owner receives 403/404 on job and evidence routes (automated
  ownership tests; production uses the same routes).
- [x] Markdown and JSON exports contain stable evidence IDs.
- [x] Retention and worker-token configuration are verified.
- [x] `/api/health/ready` returns HTTP 200 without exposing secret values.

## Files

- `docs/deployment.md`
- `.env.example`
- deployment configuration for the selected host

## Verify

Run the documented deployment checklist and record the deployment URL,
database provider, storage provider, and worker host in `docs/status.md`.

## Verification record (2026-11-09)

- Deployment: `https://opencontext-swart.vercel.app`
- Job: `cmw9naxem000108ic8u0nvfyr` completed all five stages at 100%.
- Exports: Markdown and JSON downloaded from the job page; JSON contains 16
  evidence records with IDs, timestamps, and certainty labels.
- Readiness: `/api/health/ready` returned HTTP 200 with all six checks.
- Worker host: scheduled GitHub Actions workflow every five minutes.
