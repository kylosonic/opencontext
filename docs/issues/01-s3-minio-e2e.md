# Add an S3/MinIO end-to-end upload test

## Problem

S3 command wiring is unit-tested with mocks, but no test proves that a presigned
PUT, `HEAD` verification, move, job creation, and worker download work against
a real S3-compatible service.

## Scope

- Add MinIO to a test-only Compose profile.
- Create a bucket and narrow CORS configuration.
- Exercise intent → presigned PUT → complete → worker source download.
- Skip the test unless `OPENCONTEXT_S3_E2E=1`.

## Acceptance

- [ ] Test creates a small generated video and uploads it to MinIO.
- [ ] Completion verifies size and content type.
- [ ] Worker can fetch the source through a presigned GET.
- [ ] Cleanup removes the object.
- [ ] `docs/deployment.md` documents the test setup.

## Files

- `docker-compose.yml`
- `apps/web/src/server/__tests__/`
- `apps/web/src/server/storage/s3.ts`
- `docs/deployment.md`

## Verify

```bash
OPENCONTEXT_S3_E2E=1 npm test
```
