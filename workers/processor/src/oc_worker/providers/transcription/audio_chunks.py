"""Bounded WAV chunking for providers with upload-size limits."""

from __future__ import annotations

import tempfile
import wave
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from oc_worker.models import Segment

# A WAV chunk is base64-encoded inside a JSON chat-completions request. Keep
# the raw payload below 18 MB so the resulting JSON body stays under common
# 25 MB provider limits even after framing and prompt overhead.
MAX_AUDIO_REQUEST_BYTES = 18_000_000
MAX_SEGMENT_TEXT_CHARS = 20_000


def split_transcript(text: str) -> list[str]:
    """Split model output into schema-safe pieces, preferring word boundaries."""
    remaining = text.strip()
    pieces: list[str] = []
    while len(remaining) > MAX_SEGMENT_TEXT_CHARS:
        cut = remaining.rfind(" ", 0, MAX_SEGMENT_TEXT_CHARS + 1)
        if cut < MAX_SEGMENT_TEXT_CHARS // 2:
            cut = MAX_SEGMENT_TEXT_CHARS
        piece = remaining[:cut].strip()
        if piece:
            pieces.append(piece)
        remaining = remaining[cut:].strip()
    if remaining:
        pieces.append(remaining)
    return pieces


def timed_segments(text: str, start: float, duration: float) -> list[Segment]:
    """Build schema-safe segments proportionally timed across ``duration``."""
    pieces = split_transcript(text)
    if not pieces:
        return []
    total_chars = sum(len(piece) for piece in pieces)
    cursor = start
    segments: list[Segment] = []
    for index, piece in enumerate(pieces):
        end = (
            start + duration
            if index == len(pieces) - 1
            else cursor + duration * (len(piece) / total_chars)
        )
        segments.append(
            Segment(
                start=round(cursor, 3),
                end=round(max(cursor, end), 3),
                text=piece,
            )
        )
        cursor = end
    return segments


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
            if channels <= 0 or sample_width <= 0 or frame_rate <= 0:
                raise ValueError("Invalid WAV audio stream")
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
                frames_read = min(frame_count, len(data) // frame_width)
                if frames_read <= 0:
                    break
                output = Path(tmp) / f"audio-{index + 1:03d}.wav"
                with wave.open(str(output), "wb") as chunk:
                    chunk.setnchannels(channels)
                    chunk.setsampwidth(sample_width)
                    chunk.setframerate(frame_rate)
                    chunk.writeframes(data)
                offset = start_frame / frame_rate
                chunks.append(
                    AudioChunk(output, offset, frames_read / frame_rate)
                )
                start_frame += frames_read
                index += 1
        yield chunks
