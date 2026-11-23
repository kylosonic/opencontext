"""FFmpeg invocation safety tests."""

from __future__ import annotations

import subprocess
from pathlib import Path

import oc_worker.ffmpeg as ffmpeg_module


def test_ffmpeg_uses_argument_list_without_a_shell(tmp_path: Path, monkeypatch) -> None:
    captured: dict = {}
    destination = tmp_path / "audio output.wav"

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        Path(args[-1]).write_bytes(b"wav")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module.subprocess, "run", fake_run)
    ffmpeg_module.extract_audio("input with spaces.mp4", destination)

    assert isinstance(captured["args"], list)
    assert captured["args"][-1] == str(destination)
    assert "shell" not in captured["kwargs"]


def test_ffmpeg_treats_option_like_filenames_as_paths(monkeypatch) -> None:
    captured: dict = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module.subprocess, "run", fake_run)
    dangerous = "-i /tmp/evil -vf drawtext=text=owned"
    ffmpeg_module.probe(dangerous, ffmpeg_path="ffmpeg")

    assert dangerous in captured["args"]
    assert all(isinstance(item, str) for item in captured["args"])
    assert "shell" not in captured["kwargs"]


def test_extract_image_frame_uses_single_frame_conversion(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict = {}
    destination = tmp_path / "frame_000001.jpg"

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        destination.write_bytes(b"jpeg")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module.subprocess, "run", fake_run)
    frame = ffmpeg_module.extract_image_frame("diagram.png", destination)

    assert "-frames:v" in captured["args"]
    assert captured["args"][captured["args"].index("-frames:v") + 1] == "1"
    assert (
        "-autorotate" not in captured["args"][: captured["args"].index("-i")]
    ), "autorotate is output-only; FFmpeg 6.1 rejects it before the input"
    assert captured["args"][-1] == str(destination)
    assert "shell" not in captured["kwargs"]
    assert frame == {"timestamp": 0.0, "path": destination}
