# Model-quality evaluation

OpenContext separates plumbing tests, setup smoke tests, and measured model
quality.

- **Plumbing:** fixture-provider tests verify extraction and data flow.
- **Smoke test:** one real model response proves connectivity and parsing.
- **Measured quality:** a versioned model is scored against ground truth.

The first dataset is the synthetic `synthetic-opencontext-fixture-v1`, licensed
CC0-1.0 and generated entirely in this repository. It exists to validate the
scoring pipeline. Its fixture-provider result must be labeled
`fixture-baseline`, not presented as model quality.

## Metrics

- Transcript WER and CER use normalized words and characters.
- OCR precision, recall, and F1 compare normalized line sets.
- Visual quality is keyword recall over descriptions, UI labels, and timeline
  summaries.

## Run an evaluation

Produce a context JSON with the model configuration under test, then compare it
with the dataset item:

```bash
opencontext evaluate .artifacts/context.json \
  --truth docs/evaluation/fixture-dataset.json \
  --model-name your-model \
  --model-version version-or-digest \
  --measurement-kind measured \
  --out evaluation-result.json
```

The fixture baseline is reproducible:

```bash
npm run fixture
opencontext analyze .artifacts/opencontext-fixture.mp4 --offline \
  --json .artifacts/fixture-context.json
opencontext evaluate .artifacts/fixture-context.json \
  --truth docs/evaluation/fixture-dataset.json \
  --model-name fixture --model-version 1 \
  --measurement-kind fixture-baseline \
  --out .artifacts/fixture-evaluation.json
```

## Limitations

The synthetic set does not establish real-world speech, OCR, or visual quality.
A measured claim requires at least one documented real model run and published
raw outputs. Small datasets have high variance and must not be presented as a
broad model ranking.
