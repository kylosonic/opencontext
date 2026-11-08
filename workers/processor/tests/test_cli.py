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


def test_directory_batch_writes_collision_safe_outputs(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    monkeypatch.setenv("FIXTURE_TRANSCRIPT", "Batch fixture transcript.")
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "Batch fixture text")
    inputs = tmp_path / "inputs"
    (inputs / "a").mkdir(parents=True)
    (inputs / "b").mkdir(parents=True)
    video = inputs / "a" / "fixture.mp4"
    _fixture(video)
    shutil.copyfile(video, inputs / "b" / "fixture.mp4")
    output_dir = tmp_path / "output"

    code = main(
        [
            "analyze",
            str(inputs),
            "--offline",
            "--output-dir",
            str(output_dir),
        ]
    )

    assert code == 0
    summary = json.loads(capsys.readouterr().out.strip())
    assert summary["total"] == 2
    assert summary["succeeded"] == 2
    assert summary["failed"] == 0
    assert sorted(path.name for path in output_dir.glob("*.md")) == [
        "fixture-2.md",
        "fixture.md",
    ]
    assert len(list(output_dir.glob("*.json"))) == 2
    for markdown_path in output_dir.glob("*.md"):
        payload_path = markdown_path.with_suffix(".json")
        assert payload_path.is_file()
        assert "Batch fixture transcript." in markdown_path.read_text(encoding="utf-8")
        assert json.loads(payload_path.read_text(encoding="utf-8"))["evidence"]


def test_batch_continues_after_one_failure(tmp_path: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv("FIXTURE_TRANSCRIPT", "Surviving transcript.")
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "Surviving text")
    video = tmp_path / "valid.mp4"
    _fixture(video)
    missing = tmp_path / "missing.mp4"
    output_dir = tmp_path / "output"

    code = main(
        [
            "analyze",
            str(video),
            str(missing),
            "--offline",
            "--output-dir",
            str(output_dir),
        ]
    )

    assert code == 1
    summary = json.loads(capsys.readouterr().out.strip())
    assert summary["succeeded"] == 1
    assert summary["failed"] == 1
    assert (output_dir / "valid.md").is_file()
    assert (output_dir / "valid.json").is_file()


def test_batch_rejects_single_file_output_options(tmp_path: Path) -> None:
    code = main(
        [
            "analyze",
            str(tmp_path / "one.mp4"),
            str(tmp_path / "two.mp4"),
            "--out",
            str(tmp_path / "context.md"),
        ]
    )
    assert code == 2
