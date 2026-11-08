# opencontext-video

The OpenContext media processing worker. It ingests uploaded video files and
runs the media-to-context pipeline: extracting audio and frames, transcribing
speech, applying vision and OCR, aligning results on a shared timeline, and
producing evidence-linked developer context.

The worker polls the OpenContext API, processes jobs through resumable stages,
and stores timestamped transcript, visual, and OCR evidence in the result
payload. Text claims carry stable evidence IDs and certainty labels in both
Markdown and JSON exports.

## Install

```bash
pip install opencontext-video
```

For local speech recognition:

```bash
pip install "opencontext-video[local]"
```

The `local` extra pins PyAV below 19 because Faster Whisper 1.2.1 still passes
the removed `metadata_errors` argument to `av.open()`. Remove the pin after
Faster Whisper publishes a release compatible with PyAV 19+.

## CLI

Analyze a local video without running the web app or database:

```bash
opencontext analyze video.mp4 --out context.md --json context.json
```

Use `--offline` to run the full extraction and export path with clearly labeled
fixture transcription and vision output:

```bash
opencontext analyze video.mp4 --offline --out context.md --json context.json
```

The CLI accepts `LOW`, `MEDIUM`, or `HIGH` via `--detail-level`, and provider
overrides via `--transcription-provider`, `--vision-provider`, and
`--text-provider`.

Analyze every supported video in a directory:

```bash
opencontext analyze ./recordings --output-dir ./context --offline
```

Batch mode writes collision-safe `<name>.md` and `<name>.json` pairs and prints
a JSON summary with success and failure counts. It continues after an invalid
input, preserves outputs that already succeeded, and exits non-zero when any
item fails. Use `--quiet` to suppress the summary.

Turn an existing result into a repository-aware implementation brief:

```bash
opencontext brief context.json --repo ../my-app \
  --task "Implement the recorded settings flow" --out implementation-brief.md
```

The brief preserves evidence IDs, detects repository languages and manifests,
and separates observed behavior from inferred or uncertain claims.

Score a context result against a ground-truth evaluation item:

```bash
opencontext evaluate context.json \
  --truth docs/evaluation/fixture-dataset.json \
  --model-name fixture --model-version 1 \
  --measurement-kind fixture-baseline --out evaluation.json
```

The report includes transcript WER/CER, OCR precision/recall/F1, and visual
keyword recall. Fixture, smoke-test, and measured runs remain separately labeled.

Check the local runtime and configured providers before submitting a job:

```bash
opencontext doctor --offline
opencontext doctor --offline --json
```

The report labels each item `OK`, `MISSING`, or `UNVERIFIED` without printing
API keys or tokens. Network checks are opt-in with `--check-network` and use a
three-second timeout. `--json` emits one document containing an overall `ok`
value and ordered checks for setup scripts and CI preflight checks.

When configuring `TRANSCRIPTION_PROVIDER=faster_whisper` as in `.env.example`,
install the `local` extra alongside `dev`:

```bash
cd workers/processor
python -m venv .venv
# Windows
.venv/Scripts/python -m pip install -e ".[dev,local]"
.venv/Scripts/python -m oc_worker.main
# macOS/Linux
.venv/bin/python -m pip install -e ".[dev,local]"
.venv/bin/python -m oc_worker.main
```

Use `--once` to claim and process at most one job, which is useful for
integration tests and cron-style deployments:

```bash
python -m oc_worker.main --once
```

Set `WORKER_API_TOKEN` to the same value used by the web app before starting
the worker. Provider settings are read from the worker process environment.

## Local providers

- `TRANSCRIPTION_PROVIDER=faster_whisper` runs speech recognition locally;
  install the `local` extra and allow the first model download.
- `VISION_PROVIDER=ollama` uses a locally running Ollama server.
- `OCR_PROVIDER=tesseract` extracts text independently with the local
  Tesseract binary. `OCR_PROVIDER=vision` keeps the compatibility behavior of
  deriving OCR rows from the vision provider's `visibleText`.
- `TRANSCRIPTION_PROVIDER=fixture` and `VISION_PROVIDER=fixture` provide
  deterministic, clearly labeled output for offline tests. They do not run
  speech recognition or computer vision and should not be used to claim real
  analysis quality.

The generated-video integration test is
`tests/test_e2e_fixture.py`. It invokes real FFmpeg for probing, audio
extraction, and frame extraction, while using fixture providers for inference.

## Real Ollama smoke test

The Ollama test is opt-in because it requires a downloaded vision model. Start
Ollama, pull a vision model, and run:

```bash
export OLLAMA_VISION_MODEL=qwen2.5vl:3b
ollama pull "$OLLAMA_VISION_MODEL"
OPENCONTEXT_OLLAMA_E2E=1 pytest tests/test_ollama_vision_smoke.py -q
```

The test generates a synthetic frame, records the selected model, and verifies
that the provider returns a structured visual observation. It is a setup smoke
test, not evidence of model quality.

## MCP server

Install the agent extra:

```bash
pip install "opencontext-video[agent]"
opencontext-mcp
```

The stdio MCP server exposes:

- `analyze_video` — analyze a local video and return an evidence-linked brief.
- `implementation_brief` — convert an existing context JSON result into a brief.
- `context_evidence` — return the bounded evidence ledger.

Example client configuration:

```json
{
  "mcpServers": {
    "opencontext": {
      "command": "opencontext-mcp",
      "args": []
    }
  }
}
```
