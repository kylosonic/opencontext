"""Fixture, parser, and optional real Tesseract OCR tests."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from oc_worker.errors import PermanentFailure
from oc_worker.providers.ocr.fixture import FixtureOcrProvider
from oc_worker.providers.ocr.tesseract import (
    TesseractOcrProvider,
    parse_tesseract_tsv,
)


def test_fixture_ocr_is_deterministic(monkeypatch) -> None:
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "Fixture OCR text")
    assert FixtureOcrProvider().extract(b"frame", {"timestampSec": 0}) == [
        {"text": "Fixture OCR text"}
    ]


def test_tesseract_tsv_groups_lines_and_confidence() -> None:
    tsv = "\n".join(
        [
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t80\tOpen",
            "5\t1\t1\t1\t1\t2\t10\t0\t10\t10\t90\tContext",
            "5\t1\t1\t1\t2\t1\t0\t20\t10\t10\t60\tSecond",
            "5\t1\t1\t1\t2\t2\t10\t20\t10\t10\t50\tline",
        ]
    )

    assert parse_tesseract_tsv(tsv) == [
        {"text": "Open Context", "confidence": 0.85},
        {"text": "Second line", "confidence": 0.55},
    ]


def test_missing_tesseract_is_a_permanent_failure() -> None:
    provider = TesseractOcrProvider(executable="opencontext-missing-tesseract")
    with pytest.raises(PermanentFailure, match="Tesseract executable not found"):
        provider.extract(b"not-an-image", {})


@pytest.mark.skipif(
    shutil.which("tesseract") is None or shutil.which("ffmpeg") is None,
    reason="tesseract and ffmpeg are required for the real OCR smoke test",
)
def test_tesseract_reads_generated_text_frame(tmp_path: Path) -> None:
    image = tmp_path / "text.png"
    try:
        subprocess.run(
            [
                shutil.which("ffmpeg") or "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=white:s=800x200:d=1",
                "-vf",
                "drawtext=fontcolor=black:fontsize=64:text='OpenContext OCR 123':x=30:y=70",
                "-frames:v",
                "1",
                str(image),
            ],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError:
        pytest.skip("this FFmpeg build does not support drawtext")

    rows = TesseractOcrProvider().extract(image.read_bytes(), {})
    recognized = " ".join(str(row["text"]) for row in rows).lower()
    assert "opencontext" in recognized
    assert "123" in recognized
