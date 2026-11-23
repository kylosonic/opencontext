"""Worker entrypoint loop tests."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import pytest

import oc_worker.main as worker_main
from oc_worker.config import Settings
from oc_worker.errors import PermanentFailure, TransientFailure


def test_logging_suppresses_signed_http_urls() -> None:
    worker_main._configure_logging()

    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


class _FakeApi:
    worker_id = "test-worker"

    def __init__(self) -> None:
        self.claims = 0
        self.heartbeats = 0

    @property
    def worker_api_url(self) -> str:
        return "http://worker.test"

    def claim(self) -> None:
        self.claims += 1
        return None

    def heartbeat(self) -> None:
        self.heartbeats += 1


def test_heartbeat_reports_idle_worker_and_stops_promptly() -> None:
    api = _FakeApi()
    stopper = worker_main.WorkerStopper()
    started = threading.Event()

    def stop_after_heartbeat() -> None:
        while api.heartbeats == 0:
            time.sleep(0.005)
        stopper.request_stop()

    threading.Thread(target=stop_after_heartbeat).start()
    thread = threading.Thread(
        target=worker_main._heartbeat_loop,
        args=(api, Settings(worker_id="test-worker"), stopper, started),
    )
    thread.start()
    while api.heartbeats == 0:
        time.sleep(0.005)
    stopper.request_stop()
    thread.join(1)

    assert started.is_set()
    assert not thread.is_alive()


class _FakePipeline:
    def run_job(self, job: dict[str, Any]) -> str:
        return "completed"


def test_drain_with_zero_seconds_claims_once_then_exits() -> None:
    api = _FakeApi()

    worker_main._drain(api, _FakePipeline(), 0)  # type: ignore[arg-type]

    assert api.claims == 1


def test_drain_returns_failure_for_unauthorized_worker() -> None:
    class UnauthorizedApi(_FakeApi):
        def claim(self) -> None:
            self.claims += 1
            raise PermanentFailure("worker token rejected")

    api = UnauthorizedApi()

    assert worker_main._drain(api, _FakePipeline(), 0) == 1


def test_stopper_interruptible_sleep_stops_immediately() -> None:
    stopper = worker_main.WorkerStopper()
    stopped = threading.Event()

    def request_stop() -> None:
        time.sleep(0.02)
        stopper.request_stop()
        stopped.set()

    threading.Thread(target=request_stop).start()
    started = time.monotonic()

    assert stopper.sleep(10) is False

    assert stopped.is_set()
    assert time.monotonic() - started < 1


class _TransientClaimApi(_FakeApi):
    def claim(self) -> None:
        self.claims += 1
        raise TransientFailure("API unavailable")


def test_supervisor_retries_claim_errors_and_exits_on_stop(monkeypatch) -> None:
    class RecoveringClaimApi(_TransientClaimApi):
        def claim(self) -> None:
            self.claims += 1
            if self.claims == 1:
                raise TransientFailure("API unavailable")
            return None

    api = RecoveringClaimApi()
    stopper = worker_main.WorkerStopper()
    settings = Settings(
        worker_id="test-worker",
        worker_concurrency=1,
        worker_error_backoff_seconds=0.2,
        worker_shutdown_grace_seconds=1.0,
    )

    monkeypatch.setattr(worker_main, "ApiClient", lambda **_kwargs: api)
    monkeypatch.setattr(worker_main, "Pipeline", lambda _api, _settings: _FakePipeline())
    monkeypatch.setattr(worker_main, "WorkerStopper", lambda: stopper)

    def stop_after_retry() -> None:
        time.sleep(0.04)
        stopper.request_stop()

    threading.Thread(target=stop_after_retry).start()
    result = worker_main._run_supervisor(settings)
    assert result == 0
    assert api.claims == 1


def test_supervisor_waits_for_active_job_before_exit(monkeypatch) -> None:
    finished = threading.Event()
    claimed = threading.Event()

    class SlowPipeline:
        def run_job(self, _job: dict[str, Any]) -> str:
            time.sleep(0.15)
            finished.set()
            return "completed"

    api = _FakeApi()

    def claim() -> dict[str, Any]:
        claimed.set()
        return {"job": {"id": "job-1"}}

    api.claim = claim  # type: ignore[method-assign]
    stopper = worker_main.WorkerStopper()
    settings = Settings(
        worker_id="test-worker",
        worker_concurrency=1,
        worker_shutdown_grace_seconds=2.0,
    )
    monkeypatch.setattr(worker_main, "ApiClient", lambda **_kwargs: api)
    monkeypatch.setattr(worker_main, "Pipeline", lambda _api, _settings: SlowPipeline())
    monkeypatch.setattr(worker_main, "WorkerStopper", lambda: stopper)

    def stop_during_job() -> None:
        claimed.wait(2)
        stopper.request_stop()

    threading.Thread(target=stop_during_job).start()

    assert worker_main._run_supervisor(settings) == 0
    assert finished.is_set()


def test_supervisor_waits_for_claim_before_exit(monkeypatch) -> None:
    returned = threading.Event()

    class SlowClaimApi(_FakeApi):
        def claim(self) -> None:
            self.claims += 1
            time.sleep(0.15)
            returned.set()
            return None

    api = SlowClaimApi()
    stopper = worker_main.WorkerStopper()
    settings = Settings(
        worker_id="test-worker",
        worker_concurrency=1,
        worker_shutdown_grace_seconds=2.0,
    )
    monkeypatch.setattr(worker_main, "ApiClient", lambda **_kwargs: api)
    monkeypatch.setattr(worker_main, "Pipeline", lambda _api, _settings: _FakePipeline())
    monkeypatch.setattr(worker_main, "WorkerStopper", lambda: stopper)
    threading.Thread(target=lambda: (time.sleep(0.03), stopper.request_stop())).start()

    assert worker_main._run_supervisor(settings) == 0
    assert returned.is_set()
    assert api.claims == 1


def test_supervisor_reports_shutdown_timeout(monkeypatch) -> None:
    release = threading.Event()

    class StuckPipeline:
        def run_job(self, _job: dict[str, Any]) -> str:
            release.wait(2)
            return "completed"

    api = _FakeApi()
    api.claim = lambda: {"job": {"id": "job-1"}}  # type: ignore[method-assign]
    stopper = worker_main.WorkerStopper()
    settings = Settings(
        worker_id="test-worker",
        worker_concurrency=1,
        worker_shutdown_grace_seconds=0.04,
    )
    monkeypatch.setattr(worker_main, "ApiClient", lambda **_kwargs: api)
    monkeypatch.setattr(worker_main, "Pipeline", lambda _api, _settings: StuckPipeline())
    monkeypatch.setattr(worker_main, "WorkerStopper", lambda: stopper)
    threading.Thread(target=lambda: (time.sleep(0.02), stopper.request_stop())).start()

    try:
        assert worker_main._run_supervisor(settings) == 1
    finally:
        release.set()


def test_invalid_numeric_settings_fall_back_to_defaults(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_SHUTDOWN_GRACE_SECONDS", "not-a-number")
    monkeypatch.setenv("WORKER_ERROR_BACKOFF_SECONDS", "also-not-a-number")

    settings = Settings.from_env()

    assert settings.worker_shutdown_grace_seconds == 120.0
    assert settings.worker_error_backoff_seconds == 5.0


@pytest.mark.parametrize("seconds", [120, 0])
def test_grace_seconds_accepts_boundary_values(monkeypatch, seconds: int) -> None:
    monkeypatch.setenv("WORKER_SHUTDOWN_GRACE_SECONDS", str(seconds))

    assert Settings.from_env().worker_shutdown_grace_seconds == float(seconds)


def test_job_timeout_setting_accepts_fractional_seconds(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_JOB_TIMEOUT_SECONDS", "0.25")

    assert Settings.from_env().worker_job_timeout_seconds == 0.25
