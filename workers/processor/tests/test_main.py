"""Worker entrypoint loop tests."""

from __future__ import annotations

from typing import Any

import oc_worker.main as worker_main


class _FakeApi:
    worker_id = "test-worker"

    def __init__(self) -> None:
        self.claims = 0

    def claim(self) -> None:
        self.claims += 1
        return None


class _FakePipeline:
    def run_job(self, job: dict[str, Any]) -> str:
        return "completed"


def test_drain_with_zero_seconds_claims_once_then_exits() -> None:
    api = _FakeApi()

    worker_main._drain(api, _FakePipeline(), 0)  # type: ignore[arg-type]

    assert api.claims == 1
