"""FFmpeg subprocess wrappers.

All invocations use explicit list arguments (never ``shell=True``) and
run through `subprocess.run` with captured output.

``probe`` prefers ffprobe (JSON). Some minimal Windows installs ship
only ffmpeg.exe (no ffprobe); in that case it deterministically falls
back to parsing `ffmpeg -i <file>` stderr, which carries the same
Duration/Stream information. A missing audio stream is reported as
``audio_present=False`` — never an error (results.md B4).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from oc_worker.errors import PermanentFailure, TransientFailure

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_RESOLUTION_RE = re.compile(r"\b(\d{2,5})x(\d{2,5})\b")
_STREAM_RE = re.compile(r"Stream #\d+:\d+")

FFMPEG_TIMEOUT_SECONDS = 300


def _ffmpeg_path(explicit: str | None = None) -> str:
    return explicit or os.getenv("FFMPEG_PATH", "ffmpeg")


def _ffprobe_path(ffmpeg: str) -> str:
    explicit = os.getenv("FFPROBE_PATH")
    if explicit:
        return explicit
    binary = Path(ffmpeg)
    if binary.parent != Path("."):
        return str(binary.with_name("ffprobe"))
    return "ffprobe"


def _run(
    args: list[str],
    timeout: int = FFMPEG_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise PermanentFailure(f"ffmpeg binary not found: {args[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise TransientFailure(f"ffmpeg timed out: {' '.join(args)}") from exc


def probe(path: str | Path, ffmpeg_path: str | None = None) -> dict[str, Any]:
    """Return {duration, width, height, video_present, audio_present}.

    A file with no video stream yields ``video_present=False`` (and the
    pipeline turns that into a permanent "not a valid video" failure).
    """
    target = str(path)
    ffmpeg = _ffmpeg_path(ffmpeg_path)
    result = _probe_with_ffprobe(target, ffmpeg)
    if result is not None:
        return result
    return _probe_with_ffmpeg_stderr(target, ffmpeg)


def _probe_with_ffprobe(target: str, ffmpeg: str) -> dict[str, Any] | None:
    ffprobe = _ffprobe_path(ffmpeg)
    proc = _run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-show_entries",
            "stream=codec_type,width,height",
            "-of",
            "json",
            target,
        ]
    )
    if proc.returncode != 0:
        return None
    try:
        parsed = json.loads(proc.stdout)
    except ValueError:
        return None
    streams = parsed.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = any(s.get("codec_type") == "audio" for s in streams)
    return {
        "duration": _float_or_none(parsed.get("format", {}).get("duration")),
        "width": video.get("width") if video else None,
        "height": video.get("height") if video else None,
        "video_present": video is not None,
        "audio_present": audio,
    }


def _probe_with_ffmpeg_stderr(target: str, ffmpeg: str) -> dict[str, Any]:
    proc = _run([ffmpeg, "-i", target])
    stderr = proc.stderr
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    video_present = False
    audio_present = False
    for line in stderr.splitlines():
        duration_match = _DURATION_RE.search(line)
        if duration_match and duration is None:
            hours, minutes, seconds = duration_match.groups()
            duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        if not _STREAM_RE.search(line):
            continue
        lower = line.lower()
        if " video:" in lower:
            video_present = True
            resolution_match = _RESOLUTION_RE.search(line)
            if resolution_match:
                width, height = (int(v) for v in resolution_match.groups())
        elif " audio:" in lower:
            audio_present = True
    return {
        "duration": duration,
        "width": width,
        "height": height,
        "video_present": video_present,
        "audio_present": audio_present,
    }


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_audio(
    src: str | Path,
    dst: str | Path,
    ffmpeg_path: str | None = None,
) -> bool:
    """Extract the audio stream to 16 kHz mono WAV.

    Returns False when the source genuinely has no audio stream (not an
    error, results.md B4). Other failures raise TransientFailure.
    """
    ffmpeg = _ffmpeg_path(ffmpeg_path)
    proc = _run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(dst),
        ]
    )
    if proc.returncode == 0:
        return True
    if "does not contain any stream" in proc.stderr or "audio" not in proc.stderr.lower():
        return False
    raise TransientFailure(f"audio extraction failed: {proc.stderr.strip()[-300:]}")


def extract_frames(
    src: str | Path,
    outdir: str | Path,
    *,
    fps: int = 1,
    max_width: int = 1280,
    ffmpeg_path: str | None = None,
) -> list[dict[str, Any]]:
    """Extract JPEG frames at ``fps`` (max width ``max_width``).

    Returns a list of ``{timestamp, path}`` entries, timestamped by
    frame index (timestamp = index / fps), sorted chronologically.
    """
    ffmpeg = _ffmpeg_path(ffmpeg_path)
    directory = Path(outdir)
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / "frame_%06d.jpg"
    scale = f"scale='min({max_width},iw)':-2"
    proc = _run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-vf",
            f"fps={fps},{scale}",
            "-q:v",
            "3",
            str(pattern),
        ]
    )
    if proc.returncode != 0:
        raise TransientFailure(f"frame extraction failed: {proc.stderr.strip()[-300:]}")
    files = sorted(directory.glob("frame_*.jpg"))
    return [
        {"timestamp": round(float(index) / float(fps), 3), "path": file_path}
        for index, file_path in enumerate(files)
    ]
