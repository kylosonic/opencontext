# Add upload cancellation and intent cleanup

## Problem

The upload control disables a second transfer, but users cannot cancel an
in-progress direct upload. Abandoned object-storage uploads wait for expiry.

## Scope

- Add a cancel button during transfer.
- Abort the XHR and call a session-authenticated intent-cancel route.
- Delete any temporary object and mark the intent expired or remove it.
- Keep one-upload-at-a-time behavior.

## Acceptance

- [ ] Cancel aborts transfer and creates no job.
- [ ] Temporary object is removed.
- [ ] A second file can be selected immediately afterward.
- [ ] Cross-user cancellation returns 403/404 without leaking details.

## Files

- `apps/web/src/components/app/new-job-form.tsx`
- `apps/web/src/app/api/uploads/`
- `apps/web/src/server/uploads.ts`
- `apps/web/src/server/__tests__/api.jobs.test.ts`

## Verify

```bash
cd apps/web
npx vitest run src/server/__tests__/api.jobs.test.ts
```
