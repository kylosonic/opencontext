# Add a real local-model smoke test

## Problem

The generated-video test uses deterministic fixture providers. It proves the
plumbing but not Faster Whisper or Ollama integration.

## Scope

- Add an opt-in manual/CI test using Faster Whisper and Ollama.
- Use a small fixture with known speech or clearly document setup.
- Record whether the model downloaded and which model name was used.

## Acceptance

- [ ] Test is skipped unless `OPENCONTEXT_MODEL_E2E=1`.
- [ ] Test fails with actionable setup text when Ollama is unavailable.
- [ ] Transcript and at least one visual observation are asserted.
- [ ] Documentation avoids presenting one smoke test as model quality evidence.

## Files

- `workers/processor/tests/`
- `workers/processor/README.md`
- `.github/workflows/ci.yml`

## Verify

```bash
OPENCONTEXT_MODEL_E2E=1 npm test
```
