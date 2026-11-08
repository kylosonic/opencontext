FROM python:3.13-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY workers/processor/pyproject.toml workers/processor/README.md ./
COPY workers/processor/src ./src
RUN pip install --no-cache-dir ".[local]"
CMD ["python", "-m", "oc_worker.main"]
