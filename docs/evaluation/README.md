# Model-quality evaluation

OpenContext separates plumbing tests, setup smoke tests, and measured model
quality.

- **Plumbing:** fixture-provider tests verify extraction and data flow.
- **Smoke test:** one real model response proves connectivity and parsing.
- **Measured quality:** a versioned model is scored against ground truth.

The synthetic datasets are licensed CC0-1.0 and generated entirely in this
repository. `synthetic-opencontext-fixture-v1` validates the fixture and
scoring pipeline; its result must be labeled `fixture-baseline`.
`managed-ui-opencontext-v1` contains three controlled UI states and is used for
the published measured OpenCode Go vision run.
`open-speech-repository-harvard-v1` contains an attributed public speech
recording with ten known Harvard sentences for hearing measurement. Its source
URL, terms, and SHA-256 are recorded in the dataset manifest.

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

The measured video is also reproducible:

```bash
npm run evaluation:video
npm run evaluation:hearing-video
```

See the [OpenCode Go measured report](opencode-go-measured.md) for the run
configuration, result, published artifacts, and limitations.

## Limitations

The synthetic set does not establish real-world speech, OCR, or visual quality.
A measured claim requires at least one documented real model run and published
raw outputs. Small datasets have high variance and must not be presented as a
broad model ranking.

## OpenCode Go measured result

- Date: 2026-11-09
- Endpoint: `https://opencode.ai/inference/go/openai/v1`
- Model: `glm-5.3-flash`
- Input: generated `opencontext-measured-eval-v1.mp4`
- Result: 4/4 OCR lines matched and 7/7 visual keywords recalled
- Raw context: [Markdown](opencode-go-measured-context.md) and
  [JSON](opencode-go-measured-context.json)
- Score: [JSON](opencode-go-measured-evaluation.json)
- Method and limits: [measured report](opencode-go-measured.md)

This is a real measured model run, but it covers one simple synthetic visual
flow and no speech. It does not establish broad real-world accuracy.

## OpenCode Go hearing result

- Date: 2026-11-09
- Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`
- Model: `mimo-v2.6-pro`
- Input: ten public Harvard sentences from the Open Speech Repository
- Result: 1.23% WER and 0.31% CER
- Raw context: [Markdown](opencode-go-hearing-context.md) and
  [JSON](opencode-go-hearing-context.json)
- Score: [JSON](opencode-go-hearing-evaluation.json)
- Method and limits: [hearing report](opencode-go-hearing-measured.md)

This run measures audio input through a multimodal chat model. It covers one
clean English recording and does not establish speech quality across speakers
or noisy real-world audio.

## OpenCode Go smoke result

- Date: 2026-11-08
- Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`
- Model: `glm-5.3-flash`
- Input: generated `opencontext-fixture.mp4` test pattern
- Result: HTTP 200, 19 evidence records, three visual findings, and normalized
  UI, interaction, visible-text, transition, and implementation observations
- Raw output: [Markdown](opencode-go-smoke.md) and
  [JSON](opencode-go-smoke.json)

This proves hosted vision connectivity and output normalization for one
synthetic video. It is labeled as a smoke result and is not a quality score.
