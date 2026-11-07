"""Deterministic transcription provider for offline tests and demos.

This provider does not run speech recognition. It exists so the complete
media pipeline can be exercised without downloading a model or supplying
credentials. Every emitted segment is intentionally labeled as fixture data.
"""

from __future__ import annotations

import os

from oc_worker.models import Segment


class FixtureTranscriptionProvider:
    name = "fixture"

    def transcribe(self, audio_path: str) -> list[Segment]:
        del audio_path
        text = os.getenv(
            "FIXTURE_TRANSCRIPT",
            "Deterministic fixture transcription (no speech model used).",
        )
        return [Segment(start=0.0, end=1.0, text=text)]
