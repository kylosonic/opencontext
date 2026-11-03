"""HTTP client for the worker API contract (ADR-0005).

Endpoint field names are confirmed against the web route files under
`apps/web/src/app/api/worker/**` (read-only contract check):

- POST /api/worker/jobs/claim          body {workerId}     200 {job, source} | 204 idle
- GET  /api/worker/jobs/{id}/source                         200 {uri, provider, sizeBytes, filename}
- POST /api/worker/jobs/{id}/progress  body {stage, stageStatus, progress, message?}
- POST /api/worker/jobs/{id}/artifacts multipart file + kind (AUDIO|FRAME) + timestampSec
- POST /api/worker/jobs/{id}/stage-result body {stage, outcome, attempt, error?, reason?, data?}
- POST /api/worker/jobs/{id}/complete  (no body)
- POST /api/worker/jobs/{id}/fail      body {stage, error, failureKind, retryable}

Auth: `Authorization: Bearer $WORKER_API_TOKEN` on every request.
Worker identity: `x-worker-id: $WORKER_ID` header on every request —
the web API derives the worker per-request from this header
(apps/web/src/server/api-helpers.ts workerIdOf), so job-scoped calls
must carry it even though claim also sends `workerId` in the body.
Error envelope: `{"error": {code, message, stage?}}`.

Retry semantics (jobs.md B7): timeouts, transport errors, 429 and 5xx
are TransientFailure and are retried automatically — up to 2 retries
with backoff 2s then 8s — invisible unless every attempt is exhausted.
Other HTTP errors are PermanentFailure (never retried).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from oc_worker.errors import PermanentFailure, TransientFailure

log = logging.getLogger("oc_worker.api")

DEFAULT_RETRIES = 2
DEFAULT_BACKOFFS = (2.0, 8.0)


def run_with_retry[T](
    fn: Callable[[], T],
    *,
    retries: int = DEFAULT_RETRIES,
    backoffs: tuple[float, ...] = DEFAULT_BACKOFFS,
    on_retry: Callable[[Exception, float], None] | None = None,
) -> T:
    """Execute ``fn``, retrying transient failures (jobs.md B7).

    "2 attempts with backoff 2s/8s" is implemented as the initial
    attempt plus up to ``retries`` automatic retries, sleeping 2s then
    8s between attempts. Failures stay invisible unless every attempt is
    exhausted, in which case the last TransientFailure is re-raised.
    """
    last_exc: TransientFailure | None = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except TransientFailure as exc:
            last_exc = exc
            if attempt >= retries:
                break
            delay = backoffs[min(attempt, len(backoffs) - 1)]
            log.debug(
                "transient_failure=%s attempt=%d/%d retry_in=%.1fs",
                exc,
                attempt + 1,
                retries + 1,
                delay,
            )
            if on_retry is not None:
                on_retry(exc, delay)
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _error_from_response(response: httpx.Response, path: str) -> PermanentFailure:
    try:
        body = response.json()
        err = body.get("error", {}) if isinstance(body, dict) else {}
        code = err.get("code", "HTTP_ERROR")
        message = err.get("message", f"status {response.status_code}")
    except ValueError:
        code, message = "HTTP_ERROR", f"status {response.status_code}"
    return PermanentFailure(f"{code}: {message} (POST/GET {path})")


class ApiClient:
    """Typed worker-API client with Bearer auth and transparent retries."""

    def __init__(
        self,
        base_url: str,
        token: str,
        worker_id: str,
        *,
        timeout: float = 60.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.worker_id = worker_id
        self._client = client or httpx.Client(timeout=timeout)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "x-worker-id": self.worker_id,
        }

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        def call() -> Any:
            try:
                response = self._client.request(
                    method,
                    self._url(path),
                    headers=self._headers(),
                    json=json,
                    files=files,
                    data=data,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                raise TransientFailure(f"API transport error on {path}: {exc}") from exc
            if response.status_code == 204:
                return None
            if response.status_code == 429 or response.status_code >= 500:
                raise TransientFailure(f"API {path} returned {response.status_code}")
            if response.status_code >= 400:
                raise _error_from_response(response, path)
            try:
                return response.json()
            except ValueError as exc:
                raise TransientFailure(f"API {path} returned non-JSON body") from exc

        return run_with_retry(call)

    # -- worker endpoints -------------------------------------------------

    def claim(self) -> dict[str, Any] | None:
        """Claim the next queued job; None when the queue is idle (204)."""
        return self._request("POST", "/api/worker/jobs/claim", json={"workerId": self.worker_id})

    def get_source(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/worker/jobs/{job_id}/source")

    def download_source(self, job_id: str, dest: Path) -> None:
        """Download the source media to ``dest`` (local rel path → app base)."""

        def call() -> None:
            info = self.get_source(job_id)
            uri = str(info["uri"])
            url = uri if uri.startswith(("http://", "https://")) else f"{self.base_url}{uri}"
            try:
                with self._client.stream("GET", url, headers=self._headers()) as response:
                    if response.status_code == 429 or response.status_code >= 500:
                        raise TransientFailure(f"source download returned {response.status_code}")
                    if response.status_code >= 400:
                        raise _error_from_response(response, "source")
                    with dest.open("wb") as out:
                        for chunk in response.iter_bytes():
                            out.write(chunk)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                raise TransientFailure(f"source download failed: {exc}") from exc

        run_with_retry(call)

    def progress(
        self,
        job_id: str,
        *,
        stage: str,
        stage_status: str,
        progress: int,
        message: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "stage": stage,
            "stageStatus": stage_status,
            "progress": progress,
        }
        if message is not None:
            payload["message"] = message
        return self._request("POST", f"/api/worker/jobs/{job_id}/progress", json=payload)

    def upload_artifact(
        self,
        job_id: str,
        *,
        kind: str,
        file_path: str | Path,
        timestamp_sec: float | None = None,
    ) -> dict[str, Any]:
        data: dict[str, Any] = {"kind": kind}
        if timestamp_sec is not None:
            data["timestampSec"] = str(timestamp_sec)
        path = Path(file_path)
        with path.open("rb") as handle:
            files = {"file": (path.name, handle, "application/octet-stream")}
            return self._request(
                "POST", f"/api/worker/jobs/{job_id}/artifacts", files=files, data=data
            )

    def stage_result(
        self,
        job_id: str,
        *,
        stage: str,
        outcome: str,
        attempt: int,
        error: str | None = None,
        reason: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"stage": stage, "outcome": outcome, "attempt": attempt}
        if error is not None:
            payload["error"] = error
        if reason is not None:
            payload["reason"] = reason
        if data is not None:
            payload["data"] = data
        return self._request("POST", f"/api/worker/jobs/{job_id}/stage-result", json=payload)

    def complete(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/worker/jobs/{job_id}/complete", json={})

    def fail(
        self,
        job_id: str,
        *,
        stage: str,
        error: str,
        failure_kind: str,
        retryable: bool,
    ) -> dict[str, Any]:
        payload = {
            "stage": stage,
            "error": error,
            "failureKind": failure_kind,
            "retryable": retryable,
        }
        return self._request("POST", f"/api/worker/jobs/{job_id}/fail", json=payload)
