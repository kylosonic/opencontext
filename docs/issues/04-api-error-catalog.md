# Document and test the public API error catalog

## Problem

Error codes and HTTP statuses live in the shared schema, but API consumers have
no single reference that explains when each code is returned. Adding a code
without documentation can silently create an undocumented contract.

## Scope

- Add a concise error catalog with code, HTTP status, and meaning.
- Add a test that every `ERROR_CODES` entry appears in the catalog exactly once.
- Link the catalog from the web docs and package README.

## Acceptance

- [ ] Every shared error code has a documented status and explanation.
- [ ] A test fails when a code is added without a catalog entry.
- [ ] The catalog matches `ERROR_STATUS`.
- [ ] The document does not describe internal exceptions as public codes.

## Files

- `packages/schemas/src/errors.ts`
- `packages/schemas/README.md`
- `apps/web/src/app/docs/page.tsx`
- `docs/` or `packages/schemas/` for the catalog
- `scripts/` for the catalog consistency check

## Verify

```bash
npm run build --workspace @opencontext/schemas
node --test scripts/error-catalog.test.mjs
```
