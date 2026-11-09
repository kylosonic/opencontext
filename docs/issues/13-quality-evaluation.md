# Publish a reproducible model-quality evaluation

## Problem

Pipeline tests prove plumbing, and one Faster Whisper sample proves setup, but
there is no reproducible evaluation of transcript, visual, or OCR accuracy.

## Scope

- Add a small licensed or synthetic evaluation set.
- Define transcript, OCR, and visual-observation scoring.
- Run at least one documented local or remote model configuration.
- Publish raw model outputs and methodology.

## Acceptance

- [x] Dataset provenance and license are documented.
- [x] Evaluation is rerunnable from a clean checkout.
- [x] Results distinguish fixture, smoke-test, and measured-quality claims.
- [x] Limitations and model versions are recorded.
- [x] At least one public speech recording measures transcript WER and CER.

## Files

- `workers/processor/tests/`
- `docs/`
- evaluation scripts under `scripts/`
