"""Pipeline orchestration tests with fakes — no network, no ffmpeg.

Uses an httpx.MockTransport-backed ApiClient plus injected fake
providers (transcription/vision/text) and fake ffmpeg entry points to
prove stage sequencing, progress reporting, stage-result payloads, the
complete path, and Permanent/Transient failure-to-fail mapping.
"""

import json
from collections.abc import Callable
from pathlib import Path

import httpx

from oc_worker import api_client as api_module
from oc_worker.api_client import ApiClient
from oc_worker.config import Settings
from oc_worker.errors import TransientFailure
from oc_worker.models import Segment
from oc_worker.pipeline import Pipeline

API_BASE = "http://api.test"
JOB_ID = "job-1"
MEDIA_PATH = "/media/video.mp4"


class _Handler:
    """Route-and-record fake for every worker-API request."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body: dict | bytes | None = None
        if request.content:
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body = json.loads(request.content)
            else:
                body = request.content
        self.calls.append({"method": request.method, "path": path, "body": body})
        if path == f"/api/worker/jobs/{JOB_ID}/source":
            media_uri = f"http://media.test{MEDIA_PATH}"
            return httpx.Response(200, json={"uri": media_uri, "provider": "local"})
        if path == MEDIA_PATH:
            return httpx.Response(200, content=b"media-bytes")
        if path.startswith(f"/api/worker/jobs/{JOB_ID}/"):
            # progress/artifacts/stage-result/complete/fail accept JSON
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"error": {"code": "NOT_FOUND", "message": "no"}})

    def paths(self) -> list[str]:
        return [call["path"] for call in self.calls]

    def json_requests(self) -> list[tuple[str, dict]]:
        return [
            (call["path"], call["body"])
            for call in self.calls
            if isinstance(call["body"], dict)
        ]

    def artifact_bodies(self) -> list[bytes]:
        return [
            call["body"]
            for call in self.calls
            if call["path"].endswith("/artifacts") and isinstance(call["body"], bytes)
        ]


class FakeTranscription:
    name = "fake-transcription"

    def __init__(self, segments: list[Segment] | None = None, error: Exception | None = None):
        self.segments = segments or [Segment(start=0.0, end=2.0, text="Hello")]
        self.error = error
        self.calls: list[str] = []

    def transcribe(self, audio_path: str) -> list[Segment]:
        self.calls.append(audio_path)
        if self.error is not None:
            raise self.error
        return self.segments


class FakeVision:
    name = "fake-vision"

    def __init__(self, error: Exception | None = None):
        self.error = error
        self.calls: list[tuple[bytes, dict]] = []

    def analyze(self, frame_bytes: bytes, context: dict) -> dict:
        self.calls.append((frame_bytes, context))
        if self.error is not None:
            raise self.error
        timestamp = context["timestampSec"]
        return {
            "certainty": "OBSERVED",
            "sceneTitle": f"Scene {timestamp}",
            "visualDescription": "a form",
            "uiElements": [{"type": "button", "label": "Sign in"}],
            "visibleText": [{"text": "Sign in", "confidence": 0.9}],
            "interactions": [{"action": "click", "target": "Sign in"}],
            "layoutDescription": None,
            "designObservations": [],
            "importantChanges": [],
        }


class FakeOcr:
    name = "fake-ocr"

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def extract(self, frame_bytes: bytes, context: dict) -> list[dict]:
        assert frame_bytes
        self.calls.append(context)
        return [
            {
                "text": f"Independent OCR {context['timestampSec']}",
                "confidence": 0.75,
            }
        ]


class FakeText:
    name = "fake-text"

    def __init__(self) -> None:
        self.payloads: list[dict] = []

    def refine(self, payload: dict, baseline_markdown: str) -> str:
        self.payloads.append(payload)
        return baseline_markdown + "\n(refined by fake-text)"


def _settings() -> Settings:
    return Settings(worker_api_url=API_BASE, worker_id="worker-1")


def _job(detail_level: str = "MEDIUM", stage_states: list[dict] | None = None) -> dict:
    return {
        "id": JOB_ID,
        "displayName": "Demo session",
        "status": "PROCESSING",
        "detailLevel": detail_level,
        "stageStates": stage_states or [],
        "progress": 0,
    }


def _api(handler: _Handler) -> ApiClient:
    transport = httpx.MockTransport(handler)
    return ApiClient(
        API_BASE, token="tok", worker_id="worker-1", client=httpx.Client(transport=transport)
    )


def _probe_ok(
    video_present: bool = True, audio_present: bool = True, duration: float = 12.0
) -> Callable[[str], dict]:
    def probe(source: str) -> dict:
        return {
            "duration": duration,
            "width": 640,
            "height": 360,
            "video_present": video_present,
            "audio_present": audio_present,
        }

    return probe


def _extract_audio_ok() -> Callable[[str, str], bool]:
    def extract_audio(source: str, dest: str) -> bool:
        Path(dest).write_bytes(b"fake-wav")
        return True

    return extract_audio


def _extract_frames_ok(
    timestamps: tuple[float, ...] = (0.0, 3.0),
) -> Callable[[str, str], list[dict]]:
    def extract_frames(source: str, outdir: str) -> list[dict]:
        directory = Path(outdir)
        directory.mkdir(parents=True, exist_ok=True)
        frames = []
        for index, timestamp in enumerate(timestamps, start=1):
            frame_path = directory / f"frame_{index:06d}.jpg"
            frame_path.write_bytes(b"fake-jpeg")
            frames.append({"timestamp": timestamp, "path": str(frame_path)})
        return frames

    return extract_frames


def _make_pipeline(
    handler: _Handler,
    *,
    transcription: FakeTranscription | None = None,
    vision: FakeVision | None = None,
    ocr: FakeOcr | None = None,
    text: FakeText | None = None,
    probe: Callable[[str], dict] | None = None,
    extract_audio: Callable[[str, str], bool] | None = None,
    extract_frames: Callable[[str, str], list[dict]] | None = None,
) -> Pipeline:
    return Pipeline(
        _api(handler),
        _settings(),
        transcription_provider=transcription or FakeTranscription(),
        vision_provider=vision or FakeVision(),
        ocr_provider=ocr,
        text_provider=text or FakeText(),
        probe_fn=probe or _probe_ok(),
        extract_audio_fn=extract_audio or _extract_audio_ok(),
        extract_frames_fn=extract_frames or _extract_frames_ok(),
    )


def test_happy_path_full_stage_sequence_with_factories(monkeypatch) -> None:
    """EXTRACTING→TRANSCRIBING→ANALYZING→AGGREGATING→GENERATING_CONTEXT→complete."""
    handler = _Handler()
    transcription = FakeTranscription(
        segments=[
            Segment(start=0.0, end=2.0, text="Welcome"),
            Segment(start=4.0, end=6.0, text="Goodbye"),
        ]
    )
    vision = FakeVision()
    text = FakeText()
    # factory wiring: providers are built from the (monkeypatched) factories
    monkeypatch.setattr("oc_worker.pipeline.build_transcription", lambda settings: transcription)
    monkeypatch.setattr("oc_worker.pipeline.build_vision", lambda settings: vision)
    monkeypatch.setattr("oc_worker.pipeline.build_text", lambda settings: text)

    pipeline = Pipeline(
        _api(handler),
        _settings(),
        probe_fn=_probe_ok(),
        extract_audio_fn=_extract_audio_ok(),
        extract_frames_fn=_extract_frames_ok((0.0, 3.0)),
    )
    assert pipeline.transcription_provider is transcription
    assert pipeline.vision_provider is vision
    assert pipeline.text_provider is text

    assert pipeline.run_job(_job()) == "completed"

    assert handler.paths() == [
        f"/api/worker/jobs/{JOB_ID}/source",
        MEDIA_PATH,
        f"/api/worker/jobs/{JOB_ID}/progress",  # EXTRACTING probing
        f"/api/worker/jobs/{JOB_ID}/progress",  # EXTRACTING audio
        f"/api/worker/jobs/{JOB_ID}/artifacts",  # AUDIO
        f"/api/worker/jobs/{JOB_ID}/progress",  # EXTRACTING frames
        f"/api/worker/jobs/{JOB_ID}/artifacts",  # FRAME 0.0
        f"/api/worker/jobs/{JOB_ID}/artifacts",  # FRAME 3.0
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # EXTRACTING
        f"/api/worker/jobs/{JOB_ID}/progress",  # TRANSCRIBING
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # TRANSCRIBING
        f"/api/worker/jobs/{JOB_ID}/progress",  # ANALYZING
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # ANALYZING
        f"/api/worker/jobs/{JOB_ID}/progress",  # AGGREGATING
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # AGGREGATING
        f"/api/worker/jobs/{JOB_ID}/progress",  # GENERATING_CONTEXT
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # GENERATING_CONTEXT
        f"/api/worker/jobs/{JOB_ID}/complete",
    ]
    json_requests = handler.json_requests()
    progress_bodies = [
        body for path, body in json_requests if path.endswith("/progress")
    ]
    assert progress_bodies[0] == {
        "stage": "EXTRACTING",
        "stageStatus": "RUNNING",
        "progress": 0,
        "message": "Probing source",
    }
    assert progress_bodies[1]["progress"] == 35
    assert progress_bodies[1]["message"] == "Extracting audio"
    assert progress_bodies[2]["progress"] == 60
    assert progress_bodies[2]["message"] == "Extracting frames"
    assert progress_bodies[3] == {
        "stage": "TRANSCRIBING",
        "stageStatus": "RUNNING",
        "progress": 10,
        "message": "Transcribing audio",
    }
    assert progress_bodies[4] == {
        "stage": "ANALYZING",
        "stageStatus": "RUNNING",
        "progress": 5,
        "message": "Analyzing visual frames",
    }
    assert progress_bodies[5] == {
        "stage": "AGGREGATING",
        "stageStatus": "RUNNING",
        "progress": 20,
        "message": "Aggregating timeline",
    }
    assert progress_bodies[6] == {
        "stage": "GENERATING_CONTEXT",
        "stageStatus": "RUNNING",
        "progress": 30,
        "message": "Generating developer context",
    }

    stage_results = [
        body for path, body in json_requests if path.endswith("/stage-result")
    ]
    assert [result["stage"] for result in stage_results] == [
        "EXTRACTING",
        "TRANSCRIBING",
        "ANALYZING",
        "AGGREGATING",
        "GENERATING_CONTEXT",
    ]
    assert all(result["outcome"] == "SUCCEEDED" for result in stage_results)
    assert all(result["attempt"] == 1 for result in stage_results)

    extracting_data = stage_results[0]["data"]
    assert extracting_data == {
        "durationSec": 12.0,
        "width": 640,
        "height": 360,
        "audioPresent": True,
        "frameCount": 2,
    }

    # ANALYZING stage-result posts canonical observation shapes even when
    # the vision provider returns legacy dict items (validator coercion).
    analyzing_data = stage_results[2]["data"]
    assert analyzing_data == {
        "observations": [
            {
                "timestampSec": 0.0,
                "certainty": "OBSERVED",
                "sceneTitle": "Scene 0.0",
                "visualDescription": "a form",
                "uiElements": ["Sign in"],
                "visibleText": ["Sign in"],
                "interactions": ["click"],
                "designObservations": {},
                "importantChanges": [],
                "provider": "fake-vision",
            },
            {
                "timestampSec": 3.0,
                "certainty": "OBSERVED",
                "sceneTitle": "Scene 3.0",
                "visualDescription": "a form",
                "uiElements": ["Sign in"],
                "visibleText": ["Sign in"],
                "interactions": ["click"],
                "designObservations": {},
                "importantChanges": [],
                "provider": "fake-vision",
            },
        ],
        "ocr": [
            {
                "timestampSec": 0.0,
                "text": "Sign in",
                "confidence": 0.9,
                "provider": "fake-vision",
            },
            {
                "timestampSec": 3.0,
                "text": "Sign in",
                "confidence": 0.9,
                "provider": "fake-vision",
            },
        ],
    }

    # artifacts: one AUDIO plus one FRAME per extracted frame
    artifact_bodies = handler.artifact_bodies()
    assert len(artifact_bodies) == 3
    assert b"AUDIO" in artifact_bodies[0]
    assert b"audio.wav" in artifact_bodies[0]
    assert b"FRAME" in artifact_bodies[1]
    assert b"FRAME" in artifact_bodies[2]
    assert b"frame_000001.jpg" in artifact_bodies[1]
    assert b"frame_000002.jpg" in artifact_bodies[2]

    # ANALYZING analyzed both MEDIUM-selected frames (0.0 and 3.0)
    assert len(vision.calls) == 2
    assert {context["timestampSec"] for _, context in vision.calls} == {0.0, 3.0}
    assert len(transcription.calls) == 1

    # AGGREGATING posts ONLY canonical scene rows {start,end,title,summary}
    # (zod TimelineEntrySchema shape) — no transcript/OCR/observation rows,
    # and the last row ends at the probed video duration.
    expected_timeline = [
        {"start": 0.0, "end": 3.0, "title": "Scene 0.0", "summary": "a form"},
        {"start": 3.0, "end": 12.0, "title": "Scene 3.0", "summary": "a form"},
    ]
    assert stage_results[3]["data"] == {"timeline": expected_timeline}

    # GENERATING_CONTEXT stage-result carries markdown + JSON payload
    generating_data = stage_results[-1]["data"]
    assert generating_data["markdown"].endswith("(refined by fake-text)")
    json_payload = generating_data["json"]
    assert json_payload["source"]["name"] == "Demo session"
    assert json_payload["source"]["detailLevel"] == "MEDIUM"
    assert json_payload["transcript"] == [
        {"start": 0.0, "end": 2.0, "text": "Welcome"},
        {"start": 4.0, "end": 6.0, "text": "Goodbye"},
    ]
    # the JSON payload embeds the SAME canonical rows aggregation produced
    # (the handler round-trips the body through JSON, so compare deeply)
    assert json_payload["timeline"] == expected_timeline
    assert text.payloads and text.payloads[-1]["formatVersion"] == 2
    assert text.payloads[-1] == json_payload


def test_independent_ocr_provider_replaces_vision_derived_rows() -> None:
    handler = _Handler()
    ocr = FakeOcr()
    pipeline = _make_pipeline(handler, ocr=ocr)

    assert pipeline.run_job(_job()) == "completed"

    analyzing = next(
        body
        for path, body in handler.json_requests()
        if path.endswith("/stage-result") and body.get("stage") == "ANALYZING"
    )
    assert analyzing["data"]["ocr"] == [
        {
            "timestampSec": 0.0,
            "text": "Independent OCR 0.0",
            "confidence": 0.75,
            "provider": "fake-ocr",
        },
        {
            "timestampSec": 3.0,
            "text": "Independent OCR 3.0",
            "confidence": 0.75,
            "provider": "fake-ocr",
        },
    ]
    assert len(ocr.calls) == 2


def test_no_audio_skips_transcription() -> None:
    handler = _Handler()
    transcription = FakeTranscription()
    pipeline = _make_pipeline(
        handler,
        transcription=transcription,
        probe=_probe_ok(audio_present=False),
    )
    assert pipeline.run_job(_job()) == "completed"
    assert transcription.calls == []
    # no AUDIO artifact uploaded (only the FRAME artifacts)
    artifact_bodies = handler.artifact_bodies()
    assert artifact_bodies
    assert all(b"AUDIO" not in body for body in artifact_bodies)
    stage_results = [
        body for path, body in handler.json_requests() if path.endswith("/stage-result")
    ]
    skipped = [result for result in stage_results if result["outcome"] == "SKIPPED"]
    assert skipped == [
        {
            "stage": "TRANSCRIBING",
            "outcome": "SKIPPED",
            "attempt": 1,
            "reason": "NO_AUDIO",
        }
    ]
    assert any(path.endswith("/complete") for path in handler.paths())


def test_low_detail_selects_no_frames_at_one_fps() -> None:
    handler = _Handler()
    vision = FakeVision()
    # LOW stride is 10s; a clip with frames at 1/3/5/7s has no multiple of
    # 10 -> ANALYZING gets nothing, while EXTRACTING still uploaded frames.
    pipeline = _make_pipeline(
        handler,
        vision=vision,
        extract_frames=_extract_frames_ok((1.0, 3.0, 5.0, 7.0)),
    )
    assert pipeline.run_job(_job(detail_level="LOW")) == "completed"
    assert vision.calls == []
    assert len(handler.artifact_bodies()) == 5  # 1 AUDIO + 4 FRAME artifacts
    stage_results = [
        body for path, body in handler.json_requests() if path.endswith("/stage-result")
    ]
    # no frames analyzed -> AGGREGATING posts an empty canonical timeline
    assert stage_results[3]["data"] == {"timeline": []}


def test_permanent_failure_not_a_video_fails_job() -> None:
    handler = _Handler()
    transcription = FakeTranscription()
    pipeline = _make_pipeline(
        handler,
        transcription=transcription,
        probe=_probe_ok(video_present=False),
    )
    assert pipeline.run_job(_job()) == "failed"
    assert transcription.calls == []
    fail_bodies = [
        body for path, body in handler.json_requests() if path.endswith("/fail")
    ]
    assert fail_bodies == [
        {
            "stage": "EXTRACTING",
            "error": "This file is not a valid video",
            "failureKind": "PERMANENT",
            "retryable": False,
        }
    ]
    assert "complete" not in handler.paths()


def test_permanent_failure_too_long_fails_job() -> None:
    handler = _Handler()
    pipeline = _make_pipeline(handler, probe=_probe_ok(duration=2000.0))
    assert pipeline.run_job(_job()) == "failed"
    fail_bodies = [
        body for path, body in handler.json_requests() if path.endswith("/fail")
    ]
    assert fail_bodies[0] == {
        "stage": "EXTRACTING",
        "error": "Video is longer than the 30-minute limit",
        "failureKind": "PERMANENT",
        "retryable": False,
    }
    assert "complete" not in handler.paths()


def test_transient_failure_exhausted_reports_retryable_fail(monkeypatch) -> None:
    delays: list[float] = []

    def fake_sleep(delay: float) -> None:
        delays.append(delay)

    monkeypatch.setattr(api_module.time, "sleep", fake_sleep)
    handler = _Handler()
    transcription = FakeTranscription(error=TransientFailure("provider busy"))
    pipeline = _make_pipeline(handler, transcription=transcription)
    assert pipeline.run_job(_job()) == "failed"
    assert len(transcription.calls) == 3  # initial + 2 retries (2s/8s backoff)
    assert delays == [2.0, 8.0]
    fail_bodies = [
        body for path, body in handler.json_requests() if path.endswith("/fail")
    ]
    assert fail_bodies == [
        {
            "stage": "TRANSCRIBING",
            "error": "provider busy",
            "failureKind": "TRANSIENT",
            "retryable": True,
        }
    ]
    # TRANSCRIBING never reported SUCCEEDED
    stage_results = [
        body for path, body in handler.json_requests() if path.endswith("/stage-result")
    ]
    assert all(result["stage"] != "TRANSCRIBING" for result in stage_results)
    assert "complete" not in handler.paths()


def test_transient_then_success_within_stage_is_invisible(monkeypatch) -> None:
    """B7: a stage succeeding on the second attempt surfaces no error."""
    delays: list[float] = []

    def fake_sleep(delay: float) -> None:
        delays.append(delay)

    monkeypatch.setattr(api_module.time, "sleep", fake_sleep)
    handler = _Handler()
    attempts = 0

    class FlakyTranscription:
        name = "flaky"

        def transcribe(self, audio_path: str) -> list[Segment]:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise TransientFailure("timeout")
            return [Segment(start=0.0, end=1.0, text="Recovered")]

    pipeline = _make_pipeline(handler, transcription=FlakyTranscription())
    assert pipeline.run_job(_job()) == "completed"
    assert attempts == 2
    assert delays == [2.0]
    assert not any(path.endswith("/fail") for path in handler.paths())
    assert any(path.endswith("/complete") for path in handler.paths())
    stage_results = [
        body for path, body in handler.json_requests() if path.endswith("/stage-result")
    ]
    transcribing = [
        result for result in stage_results if result["stage"] == "TRANSCRIBING"
    ]
    assert transcribing and transcribing[0]["outcome"] == "SUCCEEDED"


def test_resume_shadow_mode_skips_writes_for_succeeded_stages() -> None:
    """B5: SUCCEEDED server-side stages re-derive locally but are not re-reported."""
    handler = _Handler()
    transcription = FakeTranscription()
    vision = FakeVision()
    pipeline = _make_pipeline(handler, transcription=transcription, vision=vision)
    job = _job(
        stage_states=[
            {"stage": "EXTRACTING", "status": "SUCCEEDED", "attempt": 1},
            {"stage": "TRANSCRIBING", "status": "SUCCEEDED", "attempt": 1},
            {"stage": "ANALYZING", "status": "SUCCEEDED", "attempt": 1},
        ]
    )
    assert pipeline.run_job(job) == "completed"
    # local shadow re-derivation still ran
    assert transcription.calls
    assert vision.calls
    assert handler.paths() == [
        f"/api/worker/jobs/{JOB_ID}/source",
        MEDIA_PATH,
        f"/api/worker/jobs/{JOB_ID}/progress",  # AGGREGATING
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # AGGREGATING
        f"/api/worker/jobs/{JOB_ID}/progress",  # GENERATING_CONTEXT
        f"/api/worker/jobs/{JOB_ID}/stage-result",  # GENERATING_CONTEXT
        f"/api/worker/jobs/{JOB_ID}/complete",
    ]
    assert handler.artifact_bodies() == []  # no re-uploads in shadow mode
    reported_stages = [
        body["stage"]
        for path, body in handler.json_requests()
        if path.endswith("/stage-result")
    ]
    assert reported_stages == ["AGGREGATING", "GENERATING_CONTEXT"]


def test_attempt_count_increments_from_server_state() -> None:
    handler = _Handler()
    pipeline = _make_pipeline(handler)
    job = _job(stage_states=[{"stage": "EXTRACTING", "status": "FAILED", "attempt": 2}])
    assert pipeline.run_job(job) == "completed"
    stage_results = [
        body for path, body in handler.json_requests() if path.endswith("/stage-result")
    ]
    assert stage_results[0]["stage"] == "EXTRACTING"
    assert stage_results[0]["attempt"] == 3


def test_canonical_vision_payload_flows_through_untouched() -> None:
    """A provider obeying the canonical prompt keeps canonical shapes and
    still produces OCR rows from string visibleText (confidence omitted)."""

    class CanonicalVision:
        name = "canonical-vision"
        calls: list[tuple[bytes, dict]] = []

        def analyze(self, frame_bytes: bytes, context: dict) -> dict:
            self.calls.append((frame_bytes, context))
            return {
                "certainty": "OBSERVED",
                "sceneTitle": "Login",
                "visualDescription": "a centered form",
                "uiElements": ["Email field", "Password field", "Sign in button"],
                "visibleText": ["Email", "Password", "Sign in"],
                "interactions": ["The user enters credentials", "The user clicks Sign in"],
                "layoutDescription": "Centered card",
                "designObservations": {"spacing": "8px grid", "layout": "Centered card"},
                "importantChanges": ["Sign in button becomes enabled"],
            }

    vision = CanonicalVision()
    handler = _Handler()
    pipeline = _make_pipeline(
        handler, vision=vision, extract_frames=_extract_frames_ok((0.0,))
    )
    assert pipeline.run_job(_job()) == "completed"
    stage_results = [
        body for path, body in handler.json_requests() if path.endswith("/stage-result")
    ]
    analyzing_data = stage_results[2]["data"]
    assert analyzing_data == {
        "observations": [
            {
                "timestampSec": 0.0,
                "certainty": "OBSERVED",
                "sceneTitle": "Login",
                "visualDescription": "a centered form",
                "uiElements": ["Email field", "Password field", "Sign in button"],
                "visibleText": ["Email", "Password", "Sign in"],
                "interactions": ["The user enters credentials", "The user clicks Sign in"],
                "layoutDescription": "Centered card",
                "designObservations": {"spacing": "8px grid", "layout": "Centered card"},
                "importantChanges": ["Sign in button becomes enabled"],
                "provider": "canonical-vision",
            }
        ],
        "ocr": [
            {"timestampSec": 0.0, "text": "Email", "provider": "canonical-vision"},
            {"timestampSec": 0.0, "text": "Password", "provider": "canonical-vision"},
            {"timestampSec": 0.0, "text": "Sign in", "provider": "canonical-vision"},
        ],
    }
    # AGGREGATING row: canonical {start,end,title,summary}; OCR/transcript
    # stay in their own collections and never appear on the timeline.
    assert stage_results[3]["data"] == {
        "timeline": [
            {
                "start": 0.0,
                "end": 12.0,
                "title": "Login",
                "summary": "a centered form; changes: Sign in button becomes enabled",
            }
        ]
    }
    # GENERATING_CONTEXT payload carries the canonical context shapes too.
    generating_data = stage_results[-1]["data"]
    json_payload = generating_data["json"]
    assert json_payload["uiHierarchy"] == ["Email field", "Password field", "Sign in button"]
    assert json_payload["interactions"] == [
        "The user enters credentials",
        "The user clicks Sign in",
    ]
    assert json_payload["stateTransitions"] == [
        {"timestampSec": 0.0, "change": "Sign in button becomes enabled"}
    ]
    # implementation notes sorted by designObservations key
    assert json_payload["implementationObservations"] == [
        {"timestampSec": 0.0, "note": "layout: Centered card"},
        {"timestampSec": 0.0, "note": "spacing: 8px grid"},
    ]
    assert json_payload["visibleText"] == [
        "Email",
        "Password",
        "Sign in",
        {"text": "Email", "confidence": None, "timestampSec": 0.0},
        {"text": "Password", "confidence": None, "timestampSec": 0.0},
        {"text": "Sign in", "confidence": None, "timestampSec": 0.0},
    ]
    # GENERATING_CONTEXT json embeds the same canonical timeline rows
    assert json_payload["timeline"] == [
        {
            "start": 0.0,
            "end": 12.0,
            "title": "Login",
            "summary": "a centered form; changes: Sign in button becomes enabled",
        }
    ]
    assert json_payload["formatVersion"] == 2
