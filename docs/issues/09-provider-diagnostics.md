# Add provider diagnostics to the worker CLI

## Problem

Provider setup failures are surfaced during job processing, after upload and
queueing. Contributors need a fast way to verify FFmpeg, transcription, vision,
and text-provider readiness.

## Scope

- Add `opencontext doctor`.
- Check binary availability, provider configuration, and optional local model
  endpoint reachability.
- Avoid printing secrets.
- Return non-zero when required dependencies are missing.

## Acceptance

- [ ] Output lists each dependency as OK, missing, or unverified.
- [ ] No API key or token value is printed.
- [ ] Network checks are opt-in or clearly timeout-bounded.
- [ ] README includes the doctor command.

## Files

- `workers/processor/src/oc_worker/cli.py`
- `workers/processor/tests/`
- `workers/processor/README.md`

## Verify

```bash
opencontext doctor --offline
```
