# Make provider configuration errors actionable

## Problem

An unknown vision or transcription provider can fall through to `None`, and a
missing OpenAI-compatible credential has the same result. The worker later
reports that no provider is configured without naming the invalid setting.

## Scope

- Reject unknown transcription and vision provider names in their factories.
- Keep the documented `none`, `off`, and empty values as explicit opt-outs.
- Distinguish an unknown provider from a supported provider with missing
  credentials.
- Add focused tests for both cases.

## Acceptance

- [x] Unknown provider names raise a configuration error naming the setting.
- [x] Supported OpenAI-compatible providers explain that the API key is
      missing when relevant.
- [x] Explicit opt-out values still return `None`.
- [x] Error messages contain no secret values.

## Files

- `workers/processor/src/oc_worker/providers/__init__.py`
- `workers/processor/tests/test_providers.py`
- `workers/processor/README.md`

## Verify

```bash
cd workers/processor
.venv/Scripts/python -m pytest tests/test_providers.py tests/test_config.py -q
```
