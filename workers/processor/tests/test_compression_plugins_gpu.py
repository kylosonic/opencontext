"""Tests for context compression, worker plugin loading/hooks, and local GPU selection."""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

from oc_worker import cli, context, doctor
from oc_worker.compression import (
    apply_context_compression,
    compress_observations,
    compress_segments,
    estimate_tokens,
)
from oc_worker.config import Settings
from oc_worker.hardware import HardwareInfo, resolve_whisper_device
from oc_worker.models import Certainty, DetailLevel, Segment, VisualObservation
from oc_worker.plugins import (
    apply_context_plugins,
    apply_frame_plugins,
    describe_plugins,
    load_plugins,
)


def _sample_obs(
    timestamp: float,
    *,
    title: str = "Checkout",
    description: str = "User sees the checkout cart and submit button",
    ui: list[str] | None = None,
    text: list[str] | None = None,
) -> VisualObservation:
    return VisualObservation(
        timestampSec=timestamp,
        certainty=Certainty.OBSERVED,
        sceneTitle=title,
        visualDescription=description,
        uiElements=ui or ["Submit button", "Cart total"],
        visibleText=text or ["Checkout", "$19.00"],
        interactions=[],
        layoutDescription="Single column checkout form",
        designObservations={"spacing": "16px"},
        importantChanges=[],
    )


def test_context_compression_dedups_and_enforces_token_budget() -> None:
    segments = [
        Segment(start=0.0, end=2.0, text="Open the cart."),
        Segment(start=2.5, end=4.0, text="Click checkout now."),
        Segment(start=12.0, end=14.0, text="Payment confirmed."),
    ]
    compact_segments = compress_segments(segments, mode="compact")
    assert len(compact_segments) == 2
    assert compact_segments[0].text == "Open the cart. Click checkout now."
    assert compact_segments[0].start == 0.0
    assert compact_segments[0].end == 4.0

    obs = [
        _sample_obs(0.0, text=["Checkout", "$19.00"]),
        _sample_obs(3.0, text=["Checkout", "$19.00", "Promo code"]),
        _sample_obs(
            10.0,
            title="Confirmation",
            description="Order receipt screen with green confirmation badge",
            ui=["Receipt card"],
            text=["Order #1024"],
        ),
    ]
    compact_obs = compress_observations(obs, mode="compact")
    assert len(compact_obs) == 2
    assert compact_obs[0].timestampSec == 0.0
    assert "Promo code" in compact_obs[0].visibleText

    markdown, payload = context.build_context(
        source_name="walkthrough.mp4",
        duration_sec=15.0,
        detail_level=DetailLevel.MEDIUM,
        segments=segments,
        observations=obs,
        ocr=[],
        timeline=[{"start": 0.0, "end": 15.0, "title": "Checkout", "summary": "Flow"}],
        compression_mode="compact",
        max_context_tokens=150,
    )
    assert payload["compression"]["mode"] == "compact"
    assert payload["compression"]["originalObservations"] == 3
    assert payload["compression"]["originalSegments"] == 3
    assert len(payload["evidence"]) >= 1
    assert (
        estimate_tokens({"evidence": payload["evidence"]}) <= 250
        or len(payload["evidence"]) == 1
    )
    assert "Developer Context" in markdown

    # Disabled compression returns clean payload without compression block
    uncompressed_md, uncompressed = context.build_context(
        source_name="walkthrough.mp4",
        duration_sec=15.0,
        detail_level=DetailLevel.LOW,
        segments=segments,
        observations=obs,
        ocr=[],
        timeline=[],
    )
    assert "compression" not in uncompressed
    assert uncompressed_md


def test_apply_context_compression_preserves_at_least_one_evidence_item() -> None:
    payload = {
        "transcript": [{"start": 0.0, "end": 1.0, "text": "Hi"}],
        "timeline": [],
        "evidence": [
            {
                "id": 1,
                "kind": "VISUAL",
                "text": "a" * 300,
                "source": {"collection": "uiHierarchy", "index": 0},
            },
            {
                "id": 2,
                "kind": "VISUAL",
                "text": "b" * 300,
                "source": {"collection": "visualFindings", "index": 0},
            },
        ],
    }
    compressed = apply_context_compression(payload, mode="aggressive", max_tokens=20)
    assert len(compressed["evidence"]) == 1
    assert compressed["evidence"][0]["id"] == 1


def test_plugin_loader_hooks_and_cli_list(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class DemoPlugin:
        name = "demo-filter"

        def on_frames_extracted(self, frames, meta):
            return [{**frame, "pluginTag": meta.get("sourceKind")} for frame in frames]

        def on_context_built(self, payload, markdown):
            payload = {**payload, "pluginApplied": self.name}
            return payload, markdown + "\n<!-- plugin:demo-filter -->\n"

    fake_mod = types.ModuleType("oc_test_fake_plugin_mod")
    fake_mod.DemoPlugin = DemoPlugin  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "oc_test_fake_plugin_mod", fake_mod)

    with pytest.raises(ValueError, match="Invalid plugin spec"):
        load_plugins(["bad-spec-without-colon"], include_entry_points=False)

    loaded = load_plugins(["oc_test_fake_plugin_mod:DemoPlugin"], include_entry_points=False)
    assert describe_plugins(loaded) == [
        {
            "name": "demo-filter",
            "hooks": ["on_frames_extracted", "on_context_built"],
        }
    ]

    frames = apply_frame_plugins(
        loaded,
        [{"path": "frame.jpg", "timestamp": 0.0}],
        {"sourceKind": "video"},
    )
    assert frames[0]["pluginTag"] == "video"

    out_payload, out_md = apply_context_plugins(loaded, {"evidence": []}, "# Title")
    assert out_payload["pluginApplied"] == "demo-filter"
    assert "<!-- plugin:demo-filter -->" in out_md

    rc = cli.main(["plugins", "list", "--plugin", "oc_test_fake_plugin_mod:DemoPlugin", "--json"])
    assert rc == 0
    captured = json.loads(capsys.readouterr().out)
    assert captured["plugins"][0]["name"] == "demo-filter"


def test_hardware_detection_resolution_and_doctor_check(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    gpu = HardwareInfo(
        accelerator="cuda",
        cuda_device_count=1,
        detail="CUDA available (1 GPU device(s))",
    )
    cpu = HardwareInfo(accelerator="cpu", cuda_device_count=0, detail="CPU inference")

    assert resolve_whisper_device("auto", "auto", hardware=gpu) == ("cuda", "float16")
    assert resolve_whisper_device("auto", "auto", hardware=cpu) == ("cpu", "int8")
    assert resolve_whisper_device("cpu", "int16", hardware=gpu) == ("cpu", "int16")

    with pytest.raises(ValueError, match="Invalid WORKER_DEVICE"):
        resolve_whisper_device("tpu", "auto", hardware=cpu)

    fake_ffmpeg = tmp_path / "ffmpeg"
    fake_ffmpeg.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    fake_ffmpeg.chmod(0o755)

    monkeypatch.setattr(doctor, "detect_hardware", lambda: gpu)
    rc = doctor.run_doctor(
        Settings(
            transcription_provider="fixture",
            vision_provider="fixture",
            ocr_provider="fixture",
            text_provider="template",
            ffmpeg_path=str(fake_ffmpeg),
            worker_device="auto",
            whisper_compute_type="auto",
        ),
        offline=True,
        json_output=True,
    )
    assert rc == 0
    report = json.loads(capsys.readouterr().out)
    hw_check = next(item for item in report["checks"] if item["name"] == "hardware")
    assert hw_check["status"] == "ok"
    assert "device=cuda" in hw_check["detail"]
    assert "compute_type=float16" in hw_check["detail"]
