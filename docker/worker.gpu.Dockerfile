# syntax=docker/dockerfile:1.7

FROM nvidia/cuda:12.9.2-cudnn-runtime-ubuntu22.04
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      ffmpeg \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models \
    HOME=/tmp \
    TMPDIR=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    OPENCONTEXT_SKIP_DOTENV=1 \
    WORKER_DEVICE=cuda \
    WHISPER_COMPUTE_TYPE=float16

RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /models \
    && chown worker:worker /models

COPY workers/processor/pyproject.toml workers/processor/README.md workers/processor/LICENSE ./
COPY workers/processor/src ./src

RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install --no-cache-dir ".[local]" \
    && chown -R worker:worker /app

USER worker
STOPSIGNAL SIGTERM
CMD ["python3", "-m", "oc_worker.main"]
