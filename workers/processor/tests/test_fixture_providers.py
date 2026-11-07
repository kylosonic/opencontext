"""Fixture providers must be useful for plumbing tests and visibly synthetic."""

from __future__ import annotations

from oc_worker.providers.transcription.fixture import FixtureTranscriptionProvider
from oc_worker.providers.vision.fixture import FixtureVisionProvider


def test_fixture_transcription_labels_itself(monkeypatch) -> None:
    monkeypatch.setenv("FIXTURE_TRANSCRIPT", "fixture transcript")
    segments = FixtureTranscriptionProvider().transcribe("unused.wav")
    assert len(segments) == 1
    assert segments[0].text == "fixture transcript"
    assert segments[0].start == 0.0


def test_fixture_vision_labels_itself(monkeypatch) -> None:
    monkeypatch.setenv("FIXTURE_VISIBLE_TEXT", "fixture visible text")
    observation = FixtureVisionProvider().analyze(b"jpeg", {"timestampSec": 2.5})
    assert observation["certainty"] == "UNCERTAIN"
    assert observation["visibleText"] == ["fixture visible text"]
    assert "no vision model used" in observation["visualDescription"]
