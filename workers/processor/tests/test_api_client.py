"""ApiClient tests over httpx.MockTransport — zero network.

Covers claim (200/204/404/500-retry), progress, stage-result, artifacts,
complete and fail payloads, plus the B7 retry semantics: transient
failures retry with 2s/8s backoff, permanent errors never retry.
"""

import json

import httpx
import pytest

from oc_worker import api_client as api_module
from oc_worker.api_client import ApiClient, run_with_retry
from oc_worker.errors import PermanentFailure, TransientFailure

CLAIM_PATH = "/api/worker/jobs/claim"


def _make_client(handler) -> ApiClient:
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport)
    return ApiClient("http://api.test", token="tok-123", worker_id="worker-1", client=client)


class _Recorder:
    """Records every request the mock transport received."""

    def __init__(self, responses: list) -> None:
        self.responses = responses
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        response = self.responses[min(len(self.requests) - 1, len(self.responses) - 1)]
        if isinstance(response, httpx.Response):
            return response
        raise response


def _json_body(request: httpx.Request) -> dict:
    return json.loads(request.content)


def _patch_sleep(monkeypatch, delays: list[float]) -> None:
    def fake_sleep(delay: float) -> None:
        delays.append(delay)

    monkeypatch.setattr(api_module.time, "sleep", fake_sleep)


# -- claim ---------------------------------------------------------------


def test_claim_returns_job_payload() -> None:
    recorder = _Recorder(
        [httpx.Response(200, json={"job": {"id": "j1"}, "source": {"uri": "/m.mp4"}})]
    )
    api = _make_client(recorder.handler)
    claimed = api.claim()
    assert claimed == {"job": {"id": "j1"}, "source": {"uri": "/m.mp4"}}
    request = recorder.requests[0]
    assert request.method == "POST"
    assert request.url.path == CLAIM_PATH
    assert request.headers["authorization"] == "Bearer tok-123"
    assert _json_body(request) == {"workerId": "worker-1"}


def test_claim_idle_returns_none() -> None:
    recorder = _Recorder([httpx.Response(204)])
    api = _make_client(recorder.handler)
    assert api.claim() is None
    assert len(recorder.requests) == 1


def test_claim_permanent_http_error_does_not_retry() -> None:
    recorder = _Recorder(
        [httpx.Response(404, json={"error": {"code": "JOB_NOT_FOUND", "message": "nope"}})]
    )
    api = _make_client(recorder.handler)
    with pytest.raises(PermanentFailure) as exc_info:
        api.claim()
    assert "JOB_NOT_FOUND: nope" in str(exc_info.value)
    assert len(recorder.requests) == 1


def test_claim_transient_server_error_retries_with_backoff(monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    recorder = _Recorder([httpx.Response(503), httpx.Response(503), httpx.Response(503)])
    api = _make_client(recorder.handler)
    with pytest.raises(TransientFailure):
        api.claim()
    assert len(recorder.requests) == 3  # initial + 2 retries
    assert delays == [2.0, 8.0]


def test_claim_transient_then_success_returns_payload(monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    recorder = _Recorder(
        [
            httpx.Response(429),
            httpx.Response(200, json={"job": {"id": "j1"}, "source": {}}),
        ]
    )
    api = _make_client(recorder.handler)
    claimed = api.claim()
    assert claimed == {"job": {"id": "j1"}, "source": {}}
    assert len(recorder.requests) == 2
    assert delays == [2.0]


# -- progress / stage-result / complete / fail ---------------------------


def test_progress_posts_stage_payload_with_message() -> None:
    recorder = _Recorder([httpx.Response(200, json={"ok": True})])
    api = _make_client(recorder.handler)
    api.progress(
        "j1", stage="EXTRACTING", stage_status="RUNNING", progress=35, message="hello"
    )
    request = recorder.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/api/worker/jobs/j1/progress"
    assert _json_body(request) == {
        "stage": "EXTRACTING",
        "stageStatus": "RUNNING",
        "progress": 35,
        "message": "hello",
    }


def test_progress_omits_message_when_none() -> None:
    recorder = _Recorder([httpx.Response(200, json={})])
    api = _make_client(recorder.handler)
    api.progress("j1", stage="TRANSCRIBING", stage_status="RUNNING", progress=10)
    assert "message" not in _json_body(recorder.requests[0])


def test_stage_result_posts_full_payload() -> None:
    recorder = _Recorder([httpx.Response(200, json={"ok": True})])
    api = _make_client(recorder.handler)
    api.stage_result(
        "j1",
        stage="ANALYZING",
        outcome="SUCCEEDED",
        attempt=2,
        data={"observations": [1]},
    )
    request = recorder.requests[0]
    assert request.url.path == "/api/worker/jobs/j1/stage-result"
    assert _json_body(request) == {
        "stage": "ANALYZING",
        "outcome": "SUCCEEDED",
        "attempt": 2,
        "data": {"observations": [1]},
    }


def test_stage_result_omits_optional_fields() -> None:
    recorder = _Recorder([httpx.Response(200, json={})])
    api = _make_client(recorder.handler)
    api.stage_result("j1", stage="EXTRACTING", outcome="SKIPPED", attempt=1)
    assert _json_body(recorder.requests[0]) == {
        "stage": "EXTRACTING",
        "outcome": "SKIPPED",
        "attempt": 1,
    }


def test_complete_posts_to_job_endpoint() -> None:
    recorder = _Recorder([httpx.Response(200, json={})])
    api = _make_client(recorder.handler)
    api.complete("j1")
    request = recorder.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/api/worker/jobs/j1/complete"
    assert _json_body(request) == {}


def test_fail_posts_failure_kind_and_retryable() -> None:
    recorder = _Recorder([httpx.Response(200, json={})])
    api = _make_client(recorder.handler)
    api.fail(
        "j1",
        stage="TRANSCRIBING",
        error="provider busy",
        failure_kind="TRANSIENT",
        retryable=True,
    )
    request = recorder.requests[0]
    assert request.url.path == "/api/worker/jobs/j1/fail"
    assert _json_body(request) == {
        "stage": "TRANSCRIBING",
        "error": "provider busy",
        "failureKind": "TRANSIENT",
        "retryable": True,
    }
    api.fail(
        "j1",
        stage="EXTRACTING",
        error="not a video",
        failure_kind="PERMANENT",
        retryable=False,
    )
    assert _json_body(recorder.requests[1])["failureKind"] == "PERMANENT"
    assert _json_body(recorder.requests[1])["retryable"] is False


# -- x-worker-id identity header (regression: NOT_CLAIMED on live API) ---
#
# The web API derives worker identity per-request via workerIdOf()
# (apps/web/src/server/api-helpers.ts): x-worker-id header -> body
# workerId -> query workerId. Claim used to pass only because it embeds
# workerId in the body; every other endpoint must carry the header or the
# server replies VALIDATION_ERROR "Job is not claimed by this worker".


def test_every_endpoint_request_carries_x_worker_id_header(tmp_path) -> None:
    recorder = _Recorder([httpx.Response(200, json={}) for _ in range(7)])
    api = _make_client(recorder.handler)

    api.claim()
    api.get_source("j1")
    api.progress("j1", stage="EXTRACTING", stage_status="RUNNING", progress=0)
    api.stage_result("j1", stage="ANALYZING", outcome="SUCCEEDED", attempt=1)
    api.complete("j1")
    api.fail(
        "j1", stage="TRANSCRIBING", error="boom", failure_kind="TRANSIENT", retryable=True
    )
    media = tmp_path / "frame.jpg"
    media.write_bytes(b"fake-jpeg-bytes")
    api.upload_artifact("j1", kind="FRAME", file_path=media)

    assert [r.url.path for r in recorder.requests] == [
        "/api/worker/jobs/claim",
        "/api/worker/jobs/j1/source",
        "/api/worker/jobs/j1/progress",
        "/api/worker/jobs/j1/stage-result",
        "/api/worker/jobs/j1/complete",
        "/api/worker/jobs/j1/fail",
        "/api/worker/jobs/j1/artifacts",
    ]
    for request in recorder.requests:
        assert request.headers["x-worker-id"] == "worker-1"


def test_headers_include_worker_id_even_when_body_also_carries_it() -> None:
    api = ApiClient("http://api.test", token="tok-123", worker_id="worker-1")
    assert api._headers()["x-worker-id"] == "worker-1"


# -- artifacts / source download -----------------------------------------


def test_upload_artifact_multipart_payload(tmp_path) -> None:
    recorder = _Recorder([httpx.Response(200, json={})])
    api = _make_client(recorder.handler)
    media = tmp_path / "frame.jpg"
    media.write_bytes(b"fake-jpeg-bytes")
    api.upload_artifact("j1", kind="FRAME", file_path=media, timestamp_sec=12.5)
    request = recorder.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/api/worker/jobs/j1/artifacts"
    assert b"fake-jpeg-bytes" in request.content
    assert b"frame.jpg" in request.content
    assert b"AUDIO" not in request.content
    assert b"timestampSec" in request.content


def test_download_source_writes_bytes(tmp_path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/worker/jobs/j1/source":
            return httpx.Response(
                200, json={"uri": "http://media.test/video.mp4", "provider": "local"}
            )
        return httpx.Response(200, content=b"media-bytes")

    api = _make_client(handler)
    dest = tmp_path / "source.bin"
    api.download_source("j1", dest)
    assert dest.read_bytes() == b"media-bytes"


def test_download_source_omits_worker_auth_for_external_presigned_url(tmp_path) -> None:
    media_headers: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/worker/jobs/j1/source":
            return httpx.Response(
                200, json={"uri": "https://bucket.s3.amazonaws.com/video.mp4?X-Amz-Signature=abc"}
            )
        media_headers.append(request.headers)
        return httpx.Response(200, content=b"media-bytes")

    api = _make_client(handler)
    dest = tmp_path / "source.bin"
    api.download_source("j1", dest)
    assert dest.read_bytes() == b"media-bytes"
    assert "authorization" not in media_headers[0]
    assert "x-worker-id" not in media_headers[0]


def test_download_source_relative_uri_resolves_against_base(tmp_path) -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/api/worker/jobs/j1/source":
            return httpx.Response(200, json={"uri": "/media/video.mp4"})
        return httpx.Response(200, content=b"media-bytes")

    api = _make_client(handler)
    dest = tmp_path / "source.bin"
    api.download_source("j1", dest)
    assert dest.read_bytes() == b"media-bytes"
    assert paths == ["/api/worker/jobs/j1/source", "/media/video.mp4"]


def test_download_source_retries_on_server_error(tmp_path, monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    media_requests: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/worker/jobs/j1/source":
            return httpx.Response(200, json={"uri": "http://media.test/video.mp4"})
        media_requests.append(1)
        return httpx.Response(500)

    api = _make_client(handler)
    dest = tmp_path / "source.bin"
    with pytest.raises(TransientFailure):
        api.download_source("j1", dest)
    assert len(media_requests) == 3
    assert delays == [2.0, 8.0]


def test_error_envelope_parsed_from_body() -> None:
    recorder = _Recorder([httpx.Response(422, json={"error": {"code": "BAD", "message": "nope"}})])
    api = _make_client(recorder.handler)
    with pytest.raises(PermanentFailure) as exc_info:
        api.progress("j1", stage="EXTRACTING", stage_status="RUNNING", progress=0)
    assert "BAD: nope" in str(exc_info.value)


# -- run_with_retry unit -------------------------------------------------


def test_run_with_retry_succeeds_first_attempt() -> None:
    calls: list[int] = []

    def succeed() -> str:
        calls.append(1)
        return "value"

    assert run_with_retry(succeed, retries=2, backoffs=(2.0, 8.0)) == "value"
    assert calls == [1]


def test_run_with_retry_transient_then_success(monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    attempts = 0
    notified: list[tuple[str, float]] = []

    def flaky() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise TransientFailure("flaky")
        return "ok"

    result = run_with_retry(
        flaky,
        retries=2,
        backoffs=(2.0, 8.0),
        on_retry=lambda exc, delay: notified.append((str(exc), delay)),
    )
    assert result == "ok"
    assert attempts == 3
    assert delays == [2.0, 8.0]
    assert notified == [("flaky", 2.0), ("flaky", 8.0)]


def test_run_with_retry_exhausted_raises_last_transient(monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    attempts = 0

    def always_fails() -> None:
        nonlocal attempts
        attempts += 1
        raise TransientFailure("boom")

    with pytest.raises(TransientFailure, match="boom"):
        run_with_retry(always_fails, retries=2, backoffs=(2.0, 8.0))
    assert attempts == 3
    assert delays == [2.0, 8.0]


def test_run_with_retry_permanent_error_never_retries(monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    attempts = 0

    def permanent() -> None:
        nonlocal attempts
        attempts += 1
        raise PermanentFailure("bad input")

    with pytest.raises(PermanentFailure, match="bad input"):
        run_with_retry(permanent, retries=2, backoffs=(2.0, 8.0))
    assert attempts == 1
    assert delays == []


def test_run_with_retry_unexpected_exception_propagates_immediately(monkeypatch) -> None:
    delays: list[float] = []
    _patch_sleep(monkeypatch, delays)
    attempts = 0

    def unexpected() -> None:
        nonlocal attempts
        attempts += 1
        raise ValueError("programming error")

    with pytest.raises(ValueError, match="programming error"):
        run_with_retry(unexpected, retries=2, backoffs=(2.0, 8.0))
    assert attempts == 1
    assert delays == []
