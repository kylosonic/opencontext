"""Bounded WAV chunking for providers with upload-size limits."""

from __future__ import annotations

import tempfile
import wave
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

MAX_AUDIO_REQUEST_BYTES = 24 * 1024 * 1024


@dataclass(frozen=True)
class AudioChunk:
    path: Path
    offset_seconds: float
    duration_seconds: float


@contextmanager
def bounded_audio_chunks(
    path: str | Path,
    *, max_bytes: int = MAX_AUDIO_REQUEST_BYTES,
) -> Iterator[list[AudioChunk]]:
    """Yield WAV chunks no larger than ``max_bytes``, preserving time offsets."""
    source = Path(path)
    if max_bytes < 1024:
        raise ValueError("Audio chunk byte limit is too small")
    if source.suffix.lower() != ".wav" or source.stat().st_size <= max_bytes:
        try:
            with wave.open(str(source), "rb") as audio:
                duration = audio.getnframes() / audio.getframerate()
        except (OSError, EOFError, wave.Error, ZeroDivisionError):
            duration = 0.0
        yield [AudioChunk(source, 0.0, duration)]
        return

    with tempfile.TemporaryDirectory(prefix="oc-audio-chunks-") as tmp:
        chunks: list[AudioChunk] = []
        with wave.open(str(source), "rb") as audio:
            channels = audio.getnchannels()
            sample_width = audio.getsampwidth()
            frame_rate = audio.getframerate()
            frame_width = max(1, channels * sample_width)
            frames_per_chunk = max(1, (max_bytes - 1024) // frame_width)
            total_frames = audio.getnframes()
            start_frame = 0
            index = 0
            while start_frame < total_frames:
                frame_count = min(frames_per_chunk, total_frames - start_frame)
                data = audio.readframes(frame_count)
                if not data:
                    break
                output = Path(tmp) / f"audio-{index + 1:03d}.wav"
                with wave.open(str(output), "wb") as chunk:
                    chunk.setnchannels(channels)
                    chunk.setsampwidth(sample_width)
                    chunk.setframerate(frame_rate)
                    chunk.writeframes(data)
                offset = start_frame / frame_rate
                chunks.append(
                    AudioChunk(output, offset, frame_count / frame_rate)
                )
                start_frame += frame_count
                index += 1
        yield chunks
