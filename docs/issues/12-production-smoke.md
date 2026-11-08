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

- [ ] A signed-in user can upload and receive a completed job.
- [ ] A non-owner receives 403/404 on job and evidence routes.
- [ ] Markdown and JSON exports contain stable evidence IDs.
- [ ] Retention and worker-token configuration are verified.

## Files

- `docs/deployment.md`
- `.env.example`
- deployment configuration for the selected host

## Verify

Run the documented deployment checklist and record the deployment URL,
database provider, storage provider, and worker host in `docs/status.md`.
