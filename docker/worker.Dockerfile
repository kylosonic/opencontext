# syntax=docker/dockerfile:1.7

FROM python:3.13-slim
WORKDIR /app
COPY workers/processor/pyproject.toml workers/processor/README.md workers/processor/LICENSE ./
COPY workers/processor/src ./src
RUN --mount=type=cache,target=/root/.cache/pip pip install ".[local]"
CMD ["python", "-m", "oc_worker.main"]
