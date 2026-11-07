# Add an optional distributed rate limiter

## Problem

The built-in limiter is per-process. A multi-instance deployment can exceed the
intended quota.

## Scope

- Keep the in-memory limiter for local development.
- Add a storage-backed adapter selected by environment.
- Apply it to uploads, retries, and evidence reviews.
- Document failure-open vs failure-closed behavior.

## Acceptance

- [ ] Tests cover allowed, blocked, reset, and backend-failure behavior.
- [ ] No provider credential is required for local development.
- [ ] `Retry-After` remains present on 429 responses.
- [ ] Deployment docs identify the supported backend.

## Files

- `apps/web/src/server/security/rate-limit.ts`
- `apps/web/src/app/api/uploads/`
- `.env.example`
- `docs/deployment.md`

## Verify

```bash
cd apps/web
npx vitest run src/server/__tests__/security.test.ts
```
