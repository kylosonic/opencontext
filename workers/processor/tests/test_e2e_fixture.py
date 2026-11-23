"""End-to-end worker pipeline against a small generated MP4 fixture.

FFmpeg creates the video in the test. Deterministic fixture providers stand
in only for speech and vision inference, so the test is offline and requires
no credentials while still exercising download, probing, audio/frame
extraction, stage reporting, aggregation, evidence generation, and export.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx
import pytest

from oc_worker.api_client import ApiClient
from oc_worker.config import Settings, resolve_ffmpeg_path
from oc_worker.pipeline import Pipeline
from oc_worker.providers.text.template import TemplateTextProvider
from oc_worker.providers.transcription.fixture import FixtureTranscriptionProvider
from oc_worker.providers.vision.fixture import FixtureVisionProvider

FFMPEG = resolve_ffmpeg_path()
pytestmark = pytest.mark.skipif(
    not Path(FFMPEG).is_file() and shutil.which(FFMPEG) is None,
    reason="ffmpeg is not installed",
)


class RecordingHandler:
    def __init__(self, source: bytes, assets: list[dict[str, Any]] | None = None) -> None:
        self.source = source
        self.assets = assets
        self.calls: list[dict[str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body: Any = None
        if request.headers.get("content-type", "").startswith("application/json"):
            body = json.loads(request.content)
        elif request.content:
            body = request.content
        self.calls.append({"path": path, "body": body})

        if path.endswith("/source"):
            if self.assets:
                return httpx.Response(
                    200,
                    json={
                        "uri": "http://media.test/fixture-assets/0.png",
                        "provider": "local",
                        "assets": [
                            {
                                "uri": f"http://media.test/fixture-assets/{index}.{asset['ext']}",
                                "provider": asset.get("provider"),
                                "sizeBytes": asset.get("sizeBytes"),
                                "filename": asset.get("filename"),
                                "kind": asset.get("kind"),
                                "ext": asset.get("ext"),
                                "mime": asset.get("mime"),
                                "order": asset.get("order"),
                            }
                            for index, asset in enumerate(self.assets)
                        ],
                    },
                )
            return httpx.Response(
                200,
                json={
                    "uri": "http://media.test/fixture.mp4",
                    "provider": "local",
                    "sizeBytes": len(self.source),
                    "filename": "fixture.mp4",
                },
            )
        if path == "/fixture.mp4":
            return httpx.Response(200, content=self.source)
        if path.startswith("/fixture-assets/"):
            index = int(path.rsplit("/", 1)[1].split(".", 1)[0])
            return httpx.Response(200, content=self.assets[index]["bytes"])
        if path.startswith("/api/worker/jobs/"):
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)

    def stage_results(self) -> list[dict[str, Any]]:
        return [
            call["body"]
            for call in self.calls
            if call["path"].endswith("/stage-result")
        ]


def _generate_fixture(path: Path) -> bytes:
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=1:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000:duration=3",
            "-shortest",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path.read_bytes()


def _generate_image_fixture(path: Path) -> bytes:
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=320x180",
            "-frames:v",
            "1",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path.read_bytes()


def test_generated_video_completes_full_pipeline(tmp_path: Path, monkeypatch) -> None:
    fixture_path = tmp_path / "opencontext-fixture.mp4"
    source = _generate_fixture(fixture_path)
    assert len(source) > 1_000

    monkeypatch.setenv("FIXTURE_TRANSCRIPT", "Synthetic fixture transcript.")
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "OpenContext local fixture")

    handler = RecordingHandler(source)
    transport = httpx.MockTransport(handler)
    api = ApiClient(
        "http://api.test",
        token="fixture-token",
        worker_id="e2e-worker",
        client=httpx.Client(transport=transport),
    )
    pipeline = Pipeline(
        api,
        Settings(worker_api_url="http://api.test", worker_id="e2e-worker"),
        transcription_provider=FixtureTranscriptionProvider(),
        vision_provider=FixtureVisionProvider(),
        text_provider=TemplateTextProvider(),
    )
    job = {
        "id": "e2e-job",
        "displayName": "opencontext-fixture.mp4",
        "detailLevel": "MEDIUM",
        "stageStates": [],
    }

    assert pipeline.run_job(job) == "completed"

    stage_results = handler.stage_results()
    assert [item["stage"] for item in stage_results] == [
        "EXTRACTING",
        "TRANSCRIBING",
        "ANALYZING",
        "AGGREGATING",
        "GENERATING_CONTEXT",
    ]
    artifacts = [call for call in handler.calls if call["path"].endswith("/artifacts")]
    assert any(b"AUDIO" in bytes(call["body"]) for call in artifacts)
    assert any(b"FRAME" in bytes(call["body"]) for call in artifacts)

    analyzing = stage_results[2]["data"]
    assert analyzing["observations"]
    assert analyzing["ocr"][0]["text"] == "OpenContext local fixture"

    generated = stage_results[-1]["data"]
    payload = generated["json"]
    assert payload["evidence"]
    assert all(
        {"id", "timestampSec", "certainty", "text"} <= set(item)
        for item in payload["evidence"]
    )
    assert payload["evidence"][0]["id"] == 1
    assert "Synthetic fixture transcript." in generated["markdown"]
    assert "OpenContext local fixture" in generated["markdown"]
    assert "E0001" in generated["markdown"]


def test_generated_image_completes_visual_pipeline(tmp_path: Path, monkeypatch) -> None:
    fixture_path = tmp_path / "opencontext-image.png"
    source = _generate_image_fixture(fixture_path)
    assert len(source) > 100

    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "Checkout total $42")
    handler = RecordingHandler(source)
    transport = httpx.MockTransport(handler)
    api = ApiClient(
        "http://api.test",
        token="fixture-token",
        worker_id="image-e2e-worker",
        client=httpx.Client(transport=transport),
    )
    pipeline = Pipeline(
        api,
        Settings(worker_api_url="http://api.test", worker_id="image-e2e-worker"),
        transcription_provider=FixtureTranscriptionProvider(),
        vision_provider=FixtureVisionProvider(),
        text_provider=TemplateTextProvider(),
    )
    job = {
        "id": "image-e2e-job",
        "displayName": "opencontext-image.png",
        "detailLevel": "MEDIUM",
        "stageStates": [],
        "source": {"ext": "png", "kind": "image"},
    }

    assert pipeline.run_job(job) == "completed"

    stage_results = handler.stage_results()
    assert [item["stage"] for item in stage_results] == [
        "EXTRACTING",
        "TRANSCRIBING",
        "ANALYZING",
        "AGGREGATING",
        "GENERATING_CONTEXT",
    ]
    assert stage_results[1]["outcome"] == "SKIPPED"
    artifacts = [call for call in handler.calls if call["path"].endswith("/artifacts")]
    assert any(b"FRAME" in bytes(call["body"]) for call in artifacts)
    assert all(b"AUDIO" not in bytes(call["body"]) for call in artifacts)

    generated = stage_results[-1]["data"]
    assert generated["json"]["source"]["kind"] == "image"
    assert all(
        finding["provider"] == "fixture"
        for finding in generated["json"]["visualFindings"]
    )
    assert "Checkout total $42" in generated["markdown"]
    assert "Still image has no audio" in generated["markdown"]


def test_generated_image_set_completes_cross_image_pipeline(
    tmp_path: Path, monkeypatch
) -> None:
    first_path = tmp_path / "first.png"
    second_path = tmp_path / "second.png"
    first = _generate_image_fixture(first_path)
    second = _generate_image_fixture(second_path)
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "Shared checkout label")
    assets = [
        {
            "filename": "first.png",
            "kind": "image",
            "ext": "png",
            "mime": "image/png",
            "order": 0,
            "bytes": first,
        },
        {
            "filename": "second.png",
            "kind": "image",
            "ext": "png",
            "mime": "image/png",
            "order": 1,
            "bytes": second,
        },
    ]
    handler = RecordingHandler(first, assets)
    api = ApiClient(
        "http://api.test",
        token="fixture-token",
        worker_id="image-set-e2e-worker",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    pipeline = Pipeline(
        api,
        Settings(worker_api_url="http://api.test", worker_id="image-set-e2e-worker"),
        transcription_provider=FixtureTranscriptionProvider(),
        vision_provider=FixtureVisionProvider(),
        text_provider=TemplateTextProvider(),
    )
    job = {
        "id": "image-set-e2e-job",
        "displayName": "2 images — first.png",
        "detailLevel": "MEDIUM",
        "stageStates": [],
        "source": {"ext": "png", "kind": "image"},
    }

    assert pipeline.run_job(job) == "completed"
    stage_results = handler.stage_results()
    assert stage_results[0]["data"]["assetCount"] == 2
    assert stage_results[2]["data"]["observations"][1]["frameId"] == "image-02"
    assert "first.png" in stage_results[-1]["data"]["markdown"]
    assert "second.png" in stage_results[-1]["data"]["markdown"]


def test_generated_pdf_completes_page_pipeline(tmp_path: Path, monkeypatch) -> None:
    from PIL import Image

    pdf_path = tmp_path / "reference.pdf"
    pages = [
        Image.new("RGB", (320, 180), "white"),
        Image.new("RGB", (320, 180), "white"),
    ]
    pages[0].save(pdf_path, save_all=True, append_images=pages[1:])
    source = pdf_path.read_bytes()
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "PDF fixture text")
    handler = RecordingHandler(source)
    api = ApiClient(
        "http://api.test",
        token="fixture-token",
        worker_id="pdf-e2e-worker",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    pipeline = Pipeline(
        api,
        Settings(worker_api_url="http://api.test", worker_id="pdf-e2e-worker"),
        transcription_provider=FixtureTranscriptionProvider(),
        vision_provider=FixtureVisionProvider(),
        text_provider=TemplateTextProvider(),
    )
    job = {
        "id": "pdf-e2e-job",
        "displayName": "reference.pdf",
        "detailLevel": "MEDIUM",
        "stageStates": [],
        "source": {"ext": "pdf", "kind": "pdf"},
    }

    assert pipeline.run_job(job) == "completed"
    stage_results = handler.stage_results()
    assert stage_results[0]["data"]["pageCount"] == 2
    assert stage_results[1]["outcome"] == "SKIPPED"
    assert "## Source Pages" in stage_results[-1]["data"]["markdown"]
    assert "PDF source has no audio" in stage_results[-1]["data"]["markdown"]
