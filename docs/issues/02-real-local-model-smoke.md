# Add a real Ollama vision smoke test

## Problem

Faster Whisper has a verified local smoke test. Vision still uses deterministic
fixture output in automated runs, so this draft covers Ollama specifically.

## Scope

- Add an opt-in manual test using a local Ollama vision model.
- Use a small fixture with known visible content and document model setup.
- Record whether the model downloaded and which model name was used.

## Acceptance

- [x] Test is skipped unless `OPENCONTEXT_OLLAMA_E2E=1`.
- [x] Test fails with actionable setup text when Ollama is unavailable.
- [x] At least one visual observation is asserted.
- [x] Documentation avoids presenting one smoke test as model quality evidence.

## Files

- `workers/processor/tests/`
- `workers/processor/README.md`
- `.github/workflows/ci.yml`

## Verify

```bash
OPENCONTEXT_OLLAMA_E2E=1 npm test
```
