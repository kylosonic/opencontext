"""Worker entrypoint: claim → process → complete/fail, idle-polling every 3s.

Structured logs carry job_id, stage, duration, status and error fields.
Concurrency is bounded by WORKER_CONCURRENCY (default 1).
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
import time
from collections.abc import Callable
from dataclasses import replace

from oc_worker.api_client import ApiClient
from oc_worker.config import Settings, load_local_env
from oc_worker.errors import PermanentFailure, ProviderConfigurationError, TransientFailure
from oc_worker.pipeline import Pipeline
from oc_worker.providers import build_ocr, build_text, build_transcription, build_vision

IDLE_POLL_SECONDS = 3
HEARTBEAT_SECONDS = 30
SHUTDOWN_POLL_SECONDS = 0.05
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"

log = logging.getLogger("oc_worker.main")


def _configure_logging() -> None:
    """Enable application logs without writing presigned HTTP URLs to CI."""
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    for noisy_logger in ("httpx", "httpcore"):
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)


class WorkerStopper:
    """Coordinates graceful worker shutdown without interrupting an active job."""

    def __init__(self) -> None:
        self.stop_event = threading.Event()
        self._lock = threading.Lock()
        self._claiming = 0
        self._reporting = 0

    def request_stop(self) -> None:
        self.stop_event.set()

    def sleep(self, seconds: float) -> bool:
        """Wait interruptibly. Returns False when shutdown was requested."""
        return not self.stop_event.wait(max(0.0, seconds))

    def begin_claim(self) -> bool:
        with self._lock:
            if self.stop_event.is_set():
                return False
            self._claiming += 1
            return True

    def finish_claim(self) -> None:
        with self._lock:
            self._claiming = max(0, self._claiming - 1)

    def begin_report(self) -> None:
        with self._lock:
            self._reporting += 1

    def finish_report(self) -> None:
        with self._lock:
            self._reporting = max(0, self._reporting - 1)

    def can_continue(self) -> bool:
        with self._lock:
            return not self.stop_event.is_set() and self._reporting == 0

    def begin_cycle(self) -> bool:
        with self._lock:
            if self.stop_event.is_set():
                return False
            self._claiming += 1
            return True

    def finish_cycle(self) -> None:
        with self._lock:
            self._claiming = max(0, self._claiming - 1)

    def active_cycles(self) -> int:
        with self._lock:
            return self._claiming

    def claim_in_flight(self) -> bool:
        with self._lock:
            return self._claiming > 0

def _install_signal_handlers(stopper: WorkerStopper) -> None:
    def request_stop(_signum: int, _frame: object) -> None:
        stopper.request_stop()

    if threading.current_thread() is not threading.main_thread():
        return
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, request_stop)


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


def _guarded_claim(
    api: ApiClient,
    pipeline: Pipeline,
    stopper: WorkerStopper,
    report: Callable[[str], str],
) -> str:
    """Claim before accepting shutdown, so a claimed job is never abandoned."""
    stopped = False
    while stopper.begin_claim():
        try:
            outcome = _process_once(api, pipeline)
        finally:
            stopper.finish_claim()
        if outcome != "idle":
            return outcome

        stopper.begin_report()
        try:
            if stopped or not stopper.sleep(IDLE_POLL_SECONDS):
                stopped = True
                return report("stopped")
        finally:
            stopper.finish_report()
    return report("stopped")


def _worker_loop(
    api: ApiClient,
    pipeline: Pipeline,
    settings: Settings,
    stopper: WorkerStopper,
) -> None:
    def report(status: str) -> str:
        log.info("worker=%s status=%s", settings.worker_id, status)
        return status

    log.info("worker=%s started api=%s", settings.worker_id, settings.worker_api_url)
    stopped = False
    consecutive_claim_errors = 0
    while stopper.can_continue():
        outcome = "stopped"
        if not stopper.begin_cycle():
            break
        try:
            try:
                outcome = _guarded_claim(api, pipeline, stopper, report)
            except (PermanentFailure, TransientFailure) as exc:
                if not stopper.can_continue():
                    stopped = True
                    continue
                report("claim_error")
                log.error("worker=%s status=claim_error error=%s", settings.worker_id, exc)
                consecutive_claim_errors += 1
                if isinstance(exc, PermanentFailure) or consecutive_claim_errors >= 3:
                    stopped = True
                    break
                stopper.sleep(settings.worker_error_backoff_seconds)
            else:
                consecutive_claim_errors = 0
        finally:
            stopper.finish_cycle()
        if stopped:
            break
        if outcome == "stopped":
            break
    if stopped or stopper.stop_event.is_set():
        report("stopped")


def _tracked_worker_loop(
    api: ApiClient,
    pipeline: Pipeline,
    settings: Settings,
    stopper: WorkerStopper,
    cycle_started: threading.Event,
) -> None:
    cycle_started.set()
    _worker_loop(api, pipeline, settings, stopper)


def _heartbeat_loop(
    api: ApiClient,
    settings: Settings,
    stopper: WorkerStopper,
    started: threading.Event,
) -> None:
    """Report idle-worker liveness without extending any job's claim lease."""
    started.set()
    while True:
        try:
            if stopper.stop_event.is_set():
                return
            api.heartbeat()
        except (PermanentFailure, TransientFailure) as exc:
            log.error("worker=%s status=heartbeat_error error=%s", settings.worker_id, exc)
        except Exception:
            log.exception("worker=%s status=heartbeat_error", settings.worker_id)
            return
        if not stopper.sleep(HEARTBEAT_SECONDS):
            return


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


def _check_demo_vision(settings: Settings) -> None:
    """Build every AI provider so configuration errors fail before any job."""
    build_transcription(settings)
    build_vision(settings)
    build_ocr(settings)
    build_text(settings)


def _demo_vision_summary(settings: Settings) -> dict[str, object]:
    output: dict[str, object] = {
        "mode": "real" if settings.demo_vision else "fixture",
        "visionProvider": settings.vision_provider.lower(),
    }
    if settings.demo_vision:
        output.update(
            {
                "baseUrl": (
                    settings.gemini_base_url
                    if settings.vision_provider.lower() == "gemini"
                    else settings.openai_base_url
                ),
                "visionModel": settings.vision_model,
            }
        )
    else:
        output["fixtureVisibleText"] = settings.fixture_visible_text
    return output


def _drain(
    api: ApiClient,
    pipeline: Pipeline,
    seconds: float,
    stopper: WorkerStopper | None = None,
) -> None:
    """Keep one Pipeline alive so model loading is not repeated per claim."""
    stopper = stopper or WorkerStopper()
    deadline = time.monotonic() + max(0.0, seconds)
    while not stopper.stop_event.is_set():
        try:
            outcome = _process_once(api, pipeline)
        except (PermanentFailure, TransientFailure) as exc:
            log.error("worker=%s status=claim_error error=%s", api.worker_id, exc)
            outcome = "error"
        if time.monotonic() >= deadline:
            return
        if outcome == "idle":
            stopper.sleep(IDLE_POLL_SECONDS)
        elif outcome == "error":
            stopper.sleep(5.0)


def _run_supervisor(settings: Settings) -> int:
    stopper = WorkerStopper()
    _install_signal_handlers(stopper)
    concurrency = max(1, settings.worker_concurrency)
    api = ApiClient(
        base_url=settings.worker_api_url,
        token=settings.worker_api_token,
        worker_id=settings.worker_id,
    )
    pipeline = Pipeline(api, settings)
    cycle_started = threading.Event()
    heartbeat_started = threading.Event()
    threads = [
        threading.Thread(
            target=_tracked_worker_loop,
            args=(api, pipeline, settings, stopper, cycle_started),
            name=f"worker-{settings.worker_id}-{index + 1}",
        )
        for index in range(concurrency)
    ]
    threads.append(
        threading.Thread(
            target=_heartbeat_loop,
            args=(api, settings, stopper, heartbeat_started),
            name=f"heartbeat-{settings.worker_id}",
        )
    )
    for thread in threads:
        thread.start()
    log.info(
        "worker=%s status=running concurrency=%d grace_seconds=%.0f",
        settings.worker_id,
        concurrency,
        settings.worker_shutdown_grace_seconds,
    )
    while not stopper.stop_event.wait(0.5):
        if not any(thread.is_alive() for thread in threads):
            log.error("worker=%s status=all_threads_exited", settings.worker_id)
            return 1

    stop_started = time.monotonic()
    grace = max(0.0, settings.worker_shutdown_grace_seconds)
    log.info(
        "worker=%s status=stopping active_work_wait_seconds=%.0f",
        settings.worker_id,
        grace,
    )
    while (
        (not cycle_started.is_set() or not heartbeat_started.is_set())
        and time.monotonic() - stop_started < grace
    ):
        time.sleep(SHUTDOWN_POLL_SECONDS)
    while stopper.active_cycles() and time.monotonic() - stop_started < grace:
        time.sleep(SHUTDOWN_POLL_SECONDS)
    deadline = stop_started + grace
    for thread in threads:
        thread.join(max(0.0, deadline - time.monotonic()))
    if any(thread.is_alive() for thread in threads):
        log.error(
            "worker=%s status=shutdown_timeout grace_seconds=%.0f "
            "lease_will_expire_if_process_is_terminated",
            settings.worker_id,
            grace,
        )
        return 1
    log.info("worker=%s status=shutdown_complete", settings.worker_id)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the OpenContext worker.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Claim and process at most one job, then exit.",
    )
    parser.add_argument(
        "--drain-seconds",
        type=float,
        default=None,
        metavar="SECONDS",
        help="Keep one worker process alive for this many seconds, then exit.",
    )
    parser.add_argument(
        "--job-timeout-seconds",
        type=float,
        default=None,
        metavar="SECONDS",
        help="Maximum processing time before a claimed job is failed.",
    )
    parser.add_argument(
        "--check-demo-vision",
        action="store_true",
        help=(
            "Validate demo AI settings without claiming a job or making a "
            "provider request; print a JSON summary and exit."
        ),
    )
    args = parser.parse_args()
    load_local_env()
    settings = Settings.from_env()
    if args.job_timeout_seconds is not None:
        settings = replace(
            settings,
            worker_job_timeout_seconds=max(0.0, args.job_timeout_seconds),
        )
    _configure_logging()
    if args.check_demo_vision:
        try:
            _check_demo_vision(settings)
        except ProviderConfigurationError as exc:
            log.error("demo vision configuration error: %s", exc)
            raise SystemExit(2) from None
        output = _demo_vision_summary(settings)
        print(json.dumps(output, sort_keys=True))
        raise SystemExit(0)
    if args.once:
        raise SystemExit(_run_once(settings))
    if args.drain_seconds is not None:
        api = ApiClient(
            base_url=settings.worker_api_url,
            token=settings.worker_api_token,
            worker_id=settings.worker_id,
        )
        pipeline = Pipeline(api, settings)
        stopper = WorkerStopper()
        _install_signal_handlers(stopper)
        log.info(
            "worker=%s draining api=%s seconds=%.0f",
            settings.worker_id,
            settings.worker_api_url,
            args.drain_seconds,
        )
        _drain(api, pipeline, args.drain_seconds, stopper)
        raise SystemExit(0)
    raise SystemExit(_run_supervisor(settings))


if __name__ == "__main__":
    main()
