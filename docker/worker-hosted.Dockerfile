# Container image for an always-running worker on a container host.
# The repository's worker.Dockerfile remains the preferred local image.
FROM python:3.13-slim@sha256:7249d5587b78209a006dc4a3b5340678f84ea729239193aa559962cd8c1fce50
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models \
    HOME=/tmp \
    TMPDIR=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    OPENCONTEXT_SKIP_DOTENV=1
RUN mkdir -p /models \
    && groupadd --system --gid 10001 worker \
    && useradd --system --uid 10001 --gid worker --home-dir /home/worker worker \
    && mkdir -p /home/worker \
    && chown 10001:10001 /models \
    && chown 10001:10001 /home/worker \
    && chmod 0755 /models

COPY workers/processor/pyproject.toml workers/processor/README.md workers/processor/LICENSE ./
COPY workers/processor/src ./src
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install ".[local]" \
    && chown -R worker:worker /app
RUN ln -s /app /home/worker/app

USER worker
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "from pathlib import Path; cmd=Path('/proc/1/cmdline').read_bytes(); assert b'oc_worker.main' in cmd"
CMD ["python", "-m", "oc_worker.main"]
