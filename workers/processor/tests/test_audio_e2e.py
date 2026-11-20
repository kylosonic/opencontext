"""Audio-backed end-to-end fixture with real Faster Whisper speech recognition.

Builds a video from the committed, attributed Open Speech Repository recording
and analyzes it with the same CLI path used by ``opencontext analyze``:
probing, audio extraction, real local speech recognition, frame analysis with
the deterministic fixture vision provider, aggregation, evidence generation,
and Markdown/JSON export. The transcript is scored against the published
ground truth instead of being asserted verbatim, so model revisions can move
the wording without hiding regressions.

Opt-in: set ``OPENCONTEXT_ASR_E2E=1`` (CI does). The first run downloads the
``tiny.en`` model into the Hugging Face cache; later runs reuse it.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from importlib.util import find_spec
from pathlib import Path

import pytest

from oc_worker.cli import analyze_file
from oc_worker.config import Settings
from oc_worker.evaluation import character_error_rate, word_error_rate
from oc_worker.ffmpeg import probe
from oc_worker.models import DetailLevel
from oc_worker.replay import validate_context

REPO_ROOT = Path(__file__).resolve().parents[3]
AUDIO = REPO_ROOT / "docs" / "evaluation" / "harvard-osr-us-10.wav"
DATASET = REPO_ROOT / "docs" / "evaluation" / "open-speech-hearing-dataset.json"
FFMPEG = shutil.which("ffmpeg")
MODEL = os.getenv("OPENCONTEXT_ASR_MODEL", "tiny.en")
ENABLED = os.getenv("OPENCONTEXT_ASR_E2E") == "1"

pytestmark = [
    pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is not installed"),
    pytest.mark.skipif(
        find_spec("faster_whisper") is None,
        reason="faster-whisper is not installed; install the [local] extra",
    ),
    pytest.mark.skipif(
        not ENABLED,
        reason="set OPENCONTEXT_ASR_E2E=1 to run",
    ),
]


def _speech_video(target: Path) -> None:
    """Encode the committed speech recording into a small video fixture."""
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
            "color=c=0x1d4ed8:s=320x180:r=2:d=34",
            "-i",
            str(AUDIO),
            "-shortest",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            str(target),
        ],
        check=True,
        capture_output=True,
    )


def test_real_speech_transcription_end_to_end(tmp_path: Path) -> None:
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    truth = dataset["item"]
    assert hashlib.sha256(AUDIO.read_bytes()).hexdigest() == truth["sourceAudio"]["sha256"]

    video = tmp_path / "opencontext-hearing-e2e.mp4"
    _speech_video(video)
    assert probe(str(video))["audio_present"] is True

    settings = Settings(
        transcription_provider="faster_whisper",
        transcription_model=MODEL,
        vision_provider="fixture",
        ocr_provider="vision",
        text_provider="template",
    )
    markdown, payload = analyze_file(
        video, settings, detail_level=DetailLevel.MEDIUM
    )

    duration = payload["source"]["durationSec"]
    assert abs(duration - truth["sourceAudio"]["durationSec"]) < 0.5
    transcript = payload["transcript"]
    assert len(transcript) >= 5
    assert transcript[0]["start"] == 0.0
    assert all(
        0.0 <= segment["start"] <= segment["end"] <= duration
        for segment in transcript
    )

    hypothesis = " ".join(segment["text"] for segment in transcript)
    assert "birch" in hypothesis.casefold()
    assert word_error_rate(truth["transcript"], hypothesis) <= 0.20
    assert character_error_rate(truth["transcript"], hypothesis) <= 0.10

    # Every segment is cited by the evidence ledger and the Markdown export,
    # and the whole payload satisfies the replay contract (ids, bounds,
    # source indexes, timeline continuity).
    transcript_evidence = {
        evidence["source"]["index"]: evidence
        for evidence in payload["evidence"]
        if evidence["kind"] == "TRANSCRIPT"
    }
    for index, segment in enumerate(transcript):
        evidence = transcript_evidence[index]
        assert evidence["text"] == segment["text"]
        assert evidence["timestampSec"] == segment["start"]
        assert evidence["endSec"] == segment["end"]
        assert evidence["certainty"] == "OBSERVED"
    assert "## Transcript" in markdown
    assert "[E0001 · 00:00 · Observed]" in markdown

    report = validate_context(payload)
    assert report["ok"] is True, report["errors"]
    assert report["counts"]["transcript"] == len(transcript)
