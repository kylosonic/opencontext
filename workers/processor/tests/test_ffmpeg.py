"""FFmpeg invocation safety tests."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import oc_worker.ffmpeg as ffmpeg_module
from oc_worker.process_sandbox import INPUT_FD_PLACEHOLDER


def test_ffmpeg_uses_argument_list_without_a_shell(tmp_path: Path, monkeypatch) -> None:
    captured: dict = {}
    destination = tmp_path / "audio output.wav"
    source = tmp_path / "input with spaces.mp4"
    source.write_bytes(b"source")

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        Path(args[-1]).write_bytes(b"wav")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module, "run_sandboxed", fake_run)
    ffmpeg_module.extract_audio(source, destination)

    assert isinstance(captured["args"], list)
    assert captured["args"][-1] == str(destination)
    assert captured["args"][captured["args"].index("-t") + 1] == "1800"
    assert captured["args"][captured["args"].index("-protocol_whitelist") + 1] == "fd"
    assert INPUT_FD_PLACEHOLDER in captured["args"]
    assert Path(captured["kwargs"]["input_path"]) == source.resolve()
    assert "shell" not in captured["kwargs"]


def test_ffmpeg_treats_option_like_filenames_as_paths(tmp_path: Path, monkeypatch) -> None:
    captured: dict = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module, "run_sandboxed", fake_run)
    dangerous = tmp_path / "-i evil -vf drawtext=text=owned"
    dangerous.write_bytes(b"not media")
    ffmpeg_module.probe(dangerous, ffmpeg_path="ffmpeg")

    assert str(dangerous.resolve()) not in captured["args"]
    assert all(isinstance(item, str) for item in captured["args"])
    assert "shell" not in captured["kwargs"]


def test_extract_image_frame_uses_single_frame_conversion(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict = {}
    destination = tmp_path / "frame_000001.jpg"
    source = tmp_path / "diagram.png"
    source.write_bytes(b"png")

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        destination.write_bytes(b"jpeg")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module, "run_sandboxed", fake_run)
    frame = ffmpeg_module.extract_image_frame(source, destination)

    assert "-frames:v" in captured["args"]
    assert captured["args"][captured["args"].index("-frames:v") + 1] == "1"
    assert (
        "-autorotate" not in captured["args"][: captured["args"].index("-i")]
    ), "autorotate is output-only; FFmpeg 6.1 rejects it before the input"
    assert captured["args"][-1] == str(destination)
    assert "shell" not in captured["kwargs"]
    assert frame == {"timestamp": 0.0, "path": destination}


def test_stderr_probe_ignores_codec_hex_identifiers(monkeypatch) -> None:
    stderr = """\
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'fixture.mp4':
  Duration: 00:00:03.00, start: 0.000000, bitrate: 201 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 320x180, 18 kb/s, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706d), 48000 Hz, mono, fltp
"""

    def fake_run(args, **kwargs):
        return subprocess.CompletedProcess(args, 1, stdout="", stderr=stderr)

    monkeypatch.setattr(ffmpeg_module, "_run", fake_run)
    result = ffmpeg_module._probe_with_ffmpeg_stderr("fixture.mp4", "ffmpeg")

    assert result == {
        "duration": 3.0,
        "width": 320,
        "height": 180,
        "video_present": True,
        "audio_present": True,
    }


def test_stderr_probe_conservatively_ignores_implausible_dimensions(
    monkeypatch,
) -> None:
    stderr = (
        "  Duration: 00:00:01.00, start: 0.000000\n"
        "  Stream #0:0: Video: h264, yuv420p, 999999x999999, 30 fps\n"
    )

    def fake_run(args, **kwargs):
        return subprocess.CompletedProcess(args, 1, stdout="", stderr=stderr)

    monkeypatch.setattr(ffmpeg_module, "_run", fake_run)
    result = ffmpeg_module._probe_with_ffmpeg_stderr("fixture.mp4", "ffmpeg")

    assert result["video_present"] is True
    assert result["width"] is None
    assert result["height"] is None


def test_bundled_ffmpeg_probe_reads_real_fixture_dimensions() -> None:
    """Regression for the actual imageio-ffmpeg binary, which has no ffprobe."""
    from oc_worker.config import resolve_ffmpeg_path

    fixture = Path(__file__).resolve().parents[3] / ".artifacts" / "opencontext-fixture.mp4"
    if not fixture.is_file():
        import pytest

        pytest.skip("real media fixture is not present")

    ffmpeg = resolve_ffmpeg_path()
    result: dict[str, Any] = ffmpeg_module.probe(fixture, ffmpeg)

    assert result["duration"] == 3.0
    assert result["width"] == 640
    assert result["height"] == 360
    assert result["video_present"] is True
    assert result["audio_present"] is True
