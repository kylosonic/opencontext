"""Base contract for transcription providers."""

from __future__ import annotations

from typing import Protocol

from oc_worker.models import Segment


class TranscriptionProvider(Protocol):
    """Transcribe an audio file into timestamped segments."""

    name: str

    def transcribe(self, audio_path: str) -> list[Segment]:
        """Return `[{start, end, text}]` segments for the given audio file."""
        ...
