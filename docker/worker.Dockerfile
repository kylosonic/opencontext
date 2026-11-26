# syntax=docker/dockerfile:1.7

FROM python:3.13-slim@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90
WORKDIR /app

# Named volumes inherit the directory metadata from the image on first use.
RUN mkdir -p /models && chown 10001:10001 /models && chmod 0755 /models

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models \
    HOME=/tmp \
    TMPDIR=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    OPENCONTEXT_SKIP_DOTENV=1
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /models \
    && chown worker:worker /models
COPY workers/processor/pyproject.toml workers/processor/README.md workers/processor/LICENSE ./
COPY workers/processor/src ./src
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install ".[local]" \
    && chown -R worker:worker /app
USER worker
STOPSIGNAL SIGTERM
CMD ["python", "-m", "oc_worker.main"]
