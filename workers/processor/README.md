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

Check the local runtime and configured providers before submitting a job:

```bash
opencontext doctor --offline
```

The report labels each item `OK`, `MISSING`, or `UNVERIFIED` without printing
API keys or tokens. Network checks are opt-in with `--check-network` and use a
three-second timeout.

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
- `TRANSCRIPTION_PROVIDER=fixture` and `VISION_PROVIDER=fixture` provide
  deterministic, clearly labeled output for offline tests. They do not run
  speech recognition or computer vision and should not be used to claim real
  analysis quality.

The generated-video integration test is
`tests/test_e2e_fixture.py`. It invokes real FFmpeg for probing, audio
extraction, and frame extraction, while using fixture providers for inference.
