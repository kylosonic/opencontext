"""Worker entrypoint: claim → process → complete/fail, idle-polling every 3s.

Structured logs carry job_id, stage, duration, status and error fields.
Concurrency is bounded by WORKER_CONCURRENCY (default 1).
"""

from __future__ import annotations

import argparse
import logging
import threading
import time

from oc_worker.api_client import ApiClient
from oc_worker.config import Settings
from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.pipeline import Pipeline

IDLE_POLL_SECONDS = 3
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"

log = logging.getLogger("oc_worker.main")


def _process_once(api: ApiClient, pipeline: Pipeline) -> str:
    claimed = api.claim()
    if claimed is None:
        return "idle"
    job = claimed.get("job") or {}
    job_id = str(job.get("id") or "?")
    log.info("job=%s status=claimed stage=EXTRACTING", job_id)
    started = time.monotonic()
    status = pipeline.run_job(job)
    log.info("job=%s status=%s duration=%.1fs", job_id, status, time.monotonic() - started)
    return status


def _worker_loop(settings: Settings, worker_number: int) -> None:
    api = ApiClient(
        base_url=settings.worker_api_url,
        token=settings.worker_api_token,
        worker_id=settings.worker_id,
    )
    pipeline = Pipeline(api, settings)
    log.info("worker=%s started api=%s", settings.worker_id, settings.worker_api_url)
    while True:
        try:
            outcome = _process_once(api, pipeline)
        except (PermanentFailure, TransientFailure) as exc:
            log.error("worker=%s status=claim_error error=%s", settings.worker_id, exc)
            outcome = "error"
        if outcome == "idle":
            time.sleep(IDLE_POLL_SECONDS)


def _run_once(settings: Settings) -> int:
    api = ApiClient(
        base_url=settings.worker_api_url,
        token=settings.worker_api_token,
        worker_id=settings.worker_id,
    )
    pipeline = Pipeline(api, settings)
    outcome = _process_once(api, pipeline)
    log.info("worker=%s status=%s", settings.worker_id, outcome)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the OpenContext worker.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Claim and process at most one job, then exit.",
    )
    args = parser.parse_args()
    settings = Settings.from_env()
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    if args.once:
        raise SystemExit(_run_once(settings))
    concurrency = max(1, settings.worker_concurrency)
    threads = [
        threading.Thread(target=_worker_loop, args=(settings, index), daemon=True)
        for index in range(concurrency)
    ]
    for thread in threads:
        thread.start()
    try:
        for thread in threads:
            thread.join()
    except KeyboardInterrupt:
        log.info("worker=%s shutting_down", settings.worker_id)


if __name__ == "__main__":
    main()
