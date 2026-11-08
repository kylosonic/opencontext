"""FFmpeg invocation safety tests."""

from __future__ import annotations

import subprocess

import oc_worker.ffmpeg as ffmpeg_module


def test_ffmpeg_uses_argument_list_without_a_shell(monkeypatch) -> None:
    captured: dict = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module.subprocess, "run", fake_run)
    ffmpeg_module.extract_audio("input with spaces.mp4", "audio output.wav")

    assert isinstance(captured["args"], list)
    assert captured["args"][-1] == "audio output.wav"
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
