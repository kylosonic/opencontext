# Run the Compose stack in CI

## Problem

Compose configuration and all component tests pass, but CI has not started the
web, worker, PostgreSQL, and storage services together.

## Scope

- Add a Compose-based CI job with a generated short video.
- Sign in with the explicit local-only identity.
- Upload through the web API and wait for a completed worker job.
- Download Markdown and JSON and assert evidence IDs.

## Acceptance

- [x] `docker compose up --build` reaches healthy web and worker services.
- [x] One real upload completes end to end.
- [x] The exported JSON contains at least one evidence record.
- [x] Logs are uploaded or printed on failure.

## Files

- `.github/workflows/ci.yml`
- `docker-compose.yml`
- `scripts/`

## Verify

```bash
docker compose up --build
```
