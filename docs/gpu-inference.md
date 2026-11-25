# Local GPU Inference Guide

OpenContext's Python worker runs CPU-first by default (`WORKER_DEVICE=auto`, falling back to `cpu` / `int8`), and can accelerate local speech transcription and local vision/text inference on GPUs without sending media to third-party APIs.

## 1. Local Speech Transcription (`faster_whisper` on NVIDIA CUDA)

Install the optional local speech extra:

```bash
cd workers/processor
pip install -e ".[local]"
```

Set explicit GPU preferences or leave `WORKER_DEVICE=auto` (automatically selects `cuda` + `float16` when CTranslate2 / `nvidia-smi` reports a CUDA GPU, or `cpu` + `int8` otherwise):

```bash
export TRANSCRIPTION_PROVIDER=faster_whisper
export TRANSCRIPTION_MODEL=small
export WORKER_DEVICE=cuda
export WHISPER_COMPUTE_TYPE=float16
```

Inspect accelerator detection with:

```bash
opencontext doctor --offline
```

Look for the `hardware` check line, e.g.:
`OK hardware: CUDA available (1 GPU device(s)); faster_whisper device=cuda, compute_type=float16`.

## 2. Docker GPU Worker (`docker/worker.gpu.Dockerfile`)

Build and run the CUDA container with the NVIDIA Container Toolkit (`--gpus all`):

```bash
docker build -f docker/worker.gpu.Dockerfile -t opencontext-worker-gpu .
docker run --rm --gpus all \
  -e WORKER_API_URL="https://your-app.example" \
  -e WORKER_API_TOKEN="$WORKER_API_TOKEN" \
  -e TRANSCRIPTION_PROVIDER=faster_whisper \
  -e TRANSCRIPTION_MODEL=base \
  -e WORKER_DEVICE=cuda \
  -e WHISPER_COMPUTE_TYPE=float16 \
  -v opencontext_models:/models \
  opencontext-worker-gpu
```

## 3. Local Vision & Text Models via Ollama (NVIDIA / AMD / Apple Silicon)

Pair CUDA Faster Whisper (or CPU Whisper) with GPU-accelerated Ollama for fully offline multimodal analysis:

```bash
ollama pull qwen2.5vl:7b
export VISION_PROVIDER=ollama
export VISION_MODEL=qwen2.5vl:7b
export OLLAMA_BASE_URL=http://localhost:11434
export OCR_PROVIDER=vision
```

On Apple Silicon (`arm64` macOS), Ollama uses Metal GPU acceleration automatically, while `WORKER_DEVICE=auto` selects CPU `int8` for `faster_whisper` (`ctranslate2` executes on CPU on macOS).
