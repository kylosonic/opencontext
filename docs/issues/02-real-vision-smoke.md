# Add a real OpenCode Go vision smoke test

## Problem

Faster Whisper has a verified local smoke test. Vision still uses deterministic
fixture output in automated runs, so this draft covers the hosted OpenCode Go
API.

## Scope

- Add an opt-in manual test using an OpenCode Go image-capable model.
- Use a small synthetic frame and document endpoint/model setup.
- Record the model ID and keep smoke-test results separate from quality claims.

## Acceptance

- [x] Test is skipped unless `OPENCONTEXT_OPENCODE_E2E=1`.
- [x] Test fails with actionable setup text when OpenCode Go is unavailable.
- [x] At least one visual observation is asserted.
- [x] Documentation avoids presenting one smoke test as model quality evidence.

## Files

- `workers/processor/tests/`
- `workers/processor/README.md`
- `.github/workflows/ci.yml`

## Verify

```bash
OPENCONTEXT_OPENCODE_E2E=1 \
OPENCODE_API_KEY=... \
OPENAI_BASE_URL=https://opencode.ai/inference/go/openai/v1 \
VISION_MODEL=glm-5.3-flash \
pytest workers/processor/tests/test_opencode_vision_smoke.py -q
```
