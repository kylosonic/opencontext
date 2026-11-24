"""Optional faster-whisper transcription provider (import-guarded).

`faster-whisper` is not a hard dependency: the import is guarded so the
worker installs and runs without it. Selecting this provider without the
library installed raises a RuntimeError that the pipeline reports as an
actionable stage error.
"""

from __future__ import annotations

from typing import Any

from oc_worker.errors import check_abort
from oc_worker.models import Segment

try:  # pragma: no cover - depends on optional dependency
    from faster_whisper import WhisperModel

    _AVAILABLE = True
except ImportError:  # pragma: no cover
    WhisperModel = None  # type: ignore[assignment]
    _AVAILABLE = False


def is_available() -> bool:
    return _AVAILABLE


class FasterWhisperTranscriptionProvider:
    name = "faster_whisper"

    def __init__(self, model: str, *, device: str = "auto", compute_type: str = "auto") -> None:
        if not _AVAILABLE:
            raise RuntimeError(
                "faster-whisper is not installed; install it or switch TRANSCRIPTION_PROVIDER"
            )
        self._model: Any = WhisperModel(model, device=device, compute_type=compute_type)

    def transcribe(self, audio_path: str) -> list[Segment]:
        segments_iter, _info = self._model.transcribe(audio_path)
        segments: list[Segment] = []
        for segment in segments_iter:
            check_abort()
            text = str(getattr(segment, "text", "") or "").strip()
            if not text:
                continue
            start = float(segment.start)
            end = max(start, float(segment.end))
            # The API schema caps one segment at 20k characters. Very long
            # decoder output is split without dropping speech.
            for offset in range(0, len(text), 20_000):
                segments.append(
                    Segment(
                        start=start,
                        end=end,
                        text=text[offset : offset + 20_000],
                    )
                )
        return segments
