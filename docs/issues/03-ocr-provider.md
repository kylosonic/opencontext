# Extract OCR into an independent provider

## Problem

OCR rows are currently derived from `visibleText` returned by the vision
provider. Deployments cannot choose an independent OCR engine or compare OCR
quality separately.

## Scope

- Add an `OcrProvider` protocol and factory.
- Support a no-op default and one real local or remote implementation.
- Keep the existing vision-derived behavior as a compatibility option.
- Report OCR failures according to the existing transient/permanent model.

## Acceptance

- [ ] OCR evidence keeps text, timestamp, confidence, and provider.
- [ ] Pipeline payload contract tests pass.
- [ ] Missing OCR provider does not fail a job unless explicitly required.
- [ ] Documentation lists supported OCR modes.

## Files

- `workers/processor/src/oc_worker/providers/`
- `workers/processor/src/oc_worker/pipeline.py`
- `workers/processor/tests/`
- `.env.example`

## Verify

```bash
cd workers/processor
.venv/Scripts/python -m pytest tests -q
```
