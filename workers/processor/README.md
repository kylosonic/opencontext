# oc-worker

The OpenContext media processing worker. It ingests uploaded video files and
runs the media-to-context pipeline: extracting audio and frames, transcribing
speech, applying vision and OCR, aligning results on a shared timeline, and
producing evidence-linked developer context.

The worker polls the OpenContext API, processes jobs through resumable stages,
and stores timestamped transcript, visual, and OCR evidence in the result
payload. Text claims carry stable evidence IDs and certainty labels in both
Markdown and JSON exports.

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

Set `WORKER_API_TOKEN` to the same value used by the web app before starting
the worker. Provider settings are read from the worker process environment.
