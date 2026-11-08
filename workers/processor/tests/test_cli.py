"""Standalone CLI tests against a generated video."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from oc_worker.cli import main

FFMPEG = shutil.which("ffmpeg")
pytestmark = pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed")


def _fixture(path: Path) -> None:
    assert FFMPEG is not None
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
            "testsrc2=size=320x180:rate=1:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000:duration=2",
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


def test_offline_cli_writes_markdown_and_json(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FIXTURE_TRANSCRIPT", "CLI fixture transcript.")
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "CLI fixture text")
    video = tmp_path / "fixture.mp4"
    _fixture(video)
    markdown = tmp_path / "context.md"
    json_path = tmp_path / "context.json"

    code = main(
        [
            "analyze",
            str(video),
            "--offline",
            "--out",
            str(markdown),
            "--json",
            str(json_path),
        ]
    )

    assert code == 0
    rendered = markdown.read_text(encoding="utf-8")
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert "CLI fixture transcript." in rendered
    assert "CLI fixture text" in rendered
    assert payload["evidence"]
    assert payload["timeline"]
