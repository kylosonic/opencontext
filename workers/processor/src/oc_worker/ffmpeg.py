"""FFmpeg subprocess wrappers.

All invocations use explicit list arguments (never ``shell=True``) and
run through the bounded process sandbox with captured output. POSIX workers
pass the source as one inherited descriptor and allow only FFmpeg's ``fd``
protocol, so nested playlists cannot reopen local paths or network URLs.

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
import shutil
import subprocess
from pathlib import Path
from typing import Any

from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.process_sandbox import (
    FFMPEG_LIMITS,
    PROBE_LIMITS,
    ResourceLimits,
    SandboxTimeout,
    media_input_args,
    resolve_executable,
    run_sandboxed,
)

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
# Resolution tokens in ffmpeg's stream summary are plain decimal dimensions
# (for example ``320x180``). The codec/stream section also contains hex
# identifiers such as ``[0x1]`` and ``(avc1 / 0x31637661)``; requiring a
# non-zero first digit keeps those from being mistaken for ``width x height``.
_RESOLUTION_RE = re.compile(r"(?<!\w)([1-9]\d{0,5})x([1-9]\d{0,5})(?!\w)")
_MAX_SANE_DIMENSION = 100_000
_STREAM_RE = re.compile(r"Stream #\d+:\d+")
_SHOWINFO_PTS_RE = re.compile(r"pts_time:\s*([0-9]+(?:\.[0-9]+)?)")

FFMPEG_TIMEOUT_SECONDS = int(FFMPEG_LIMITS.timeout_seconds)
MAX_MEDIA_DURATION_SECONDS = 1800


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
    *,
    limits: ResourceLimits = FFMPEG_LIMITS,
    input_path: str | Path | None = None,
) -> subprocess.CompletedProcess[str]:
    args = list(args)
    try:
        args[0] = str(resolve_executable(args[0]))
    except FileNotFoundError as exc:
        raise PermanentFailure(f"ffmpeg binary not found: {args[0]}") from exc
    try:
        return run_sandboxed(
            args,
            limits=limits,
            input_path=input_path,
            text=True,
        )
    except SandboxTimeout as exc:
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
    if not Path(ffprobe).is_file() and shutil.which(ffprobe) is None:
        return None
    input_args, input_path = media_input_args(target)
    proc = _run(
        [
            ffprobe,
            "-v",
            "error",
            "-nostdin",
            *input_args,
            "-show_entries",
            "format=duration",
            "-show_entries",
            "stream=codec_type,width,height",
            "-of",
            "json",
        ],
        limits=PROBE_LIMITS,
        input_path=input_path,
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
    input_args, input_path = media_input_args(target)
    proc = _run(
        [ffmpeg, "-nostdin", *input_args],
        limits=PROBE_LIMITS,
        input_path=input_path,
    )
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
            # Only inspect the post-"Video:" portion. This avoids matching
            # stream indexes or other container fields that happen to contain
            # an ``x`` token.
            video_details = line.lower().split(" video:", 1)[1]
            for resolution_match in _RESOLUTION_RE.finditer(video_details):
                candidate_width, candidate_height = (
                    int(value) for value in resolution_match.groups()
                )
                if (
                    candidate_width <= _MAX_SANE_DIMENSION
                    and candidate_height <= _MAX_SANE_DIMENSION
                ):
                    width, height = candidate_width, candidate_height
                    break
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
    *,
    max_duration_seconds: float = MAX_MEDIA_DURATION_SECONDS,
) -> bool:
    """Extract the audio stream to 16 kHz mono WAV.

    Returns False when the source genuinely has no audio stream (not an
    error, results.md B4). Other failures raise TransientFailure.
    """
    ffmpeg = _ffmpeg_path(ffmpeg_path)
    destination = Path(dst).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    input_args, input_path = media_input_args(src)
    proc = _run(
        [
            ffmpeg,
            "-nostdin",
            *input_args,
            "-y",
            "-t",
            f"{max_duration_seconds:g}",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ],
        input_path=input_path,
    )
    if (
        proc.returncode == 0
        and destination.is_file()
        and destination.stat().st_size > 0
    ):
        return True
    no_audio_markers = (
        "does not contain any stream",
        "matches no streams",
        "stream specifier ':a' matches no streams",
        "output file #0 does not contain any stream",
    )
    if any(marker in proc.stderr.lower() for marker in no_audio_markers):
        return False
    raise TransientFailure(f"audio extraction failed: {proc.stderr.strip()[-300:]}")


def clamp_scene_threshold(value: float) -> float:
    return max(0.05, min(0.95, float(value)))


def build_hybrid_filter(fps: float, max_width: int, scene_threshold: float) -> str:
    """Build an FFmpeg select+showinfo filter capturing scene changes or fixed intervals."""
    scale = _bounded_scale(max_width)
    interval = round(1.0 / max(float(fps), 1e-4), 4)
    threshold = round(clamp_scene_threshold(scene_threshold), 4)
    return (
        f"select='eq(n,0)+gt(scene,{threshold})+isnan(prev_selected_t)"
        f"+gte(t-prev_selected_t,{interval})',showinfo,{scale}"
    )


def parse_showinfo_timestamps(stderr: str) -> list[float]:
    """Extract ordered pts_time timestamps logged by FFmpeg's showinfo filter."""
    return [float(match.group(1)) for match in _SHOWINFO_PTS_RE.finditer(stderr)]


def _extract_fixed_frames(
    src: str | Path,
    directory: Path,
    *,
    fps: float,
    max_width: int,
    max_frames: int,
    ffmpeg: str,
    max_duration_seconds: float,
) -> list[dict[str, Any]]:
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / "frame_%06d.jpg"
    for stale in directory.glob("frame_*.jpg"):
        stale.unlink(missing_ok=True)
    scale = _bounded_scale(max_width)
    input_args, input_path = media_input_args(src)
    proc = _run(
        [
            ffmpeg,
            "-y",
            "-nostdin",
            *input_args,
            "-t",
            f"{max_duration_seconds:g}",
            "-vf",
            f"fps={fps},{scale}",
            "-frames:v",
            str(max(1, max_frames)),
            "-q:v",
            "3",
            str(pattern),
        ],
        input_path=input_path,
    )
    if proc.returncode != 0:
        raise TransientFailure(f"frame extraction failed: {proc.stderr.strip()[-300:]}")
    files = sorted(directory.glob("frame_*.jpg"))
    return [
        {"timestamp": round(float(index) / float(fps), 3), "path": file_path}
        for index, file_path in enumerate(files)
    ]


def extract_frames(
    src: str | Path,
    outdir: str | Path,
    *,
    fps: float = 1.0,
    max_width: int = 1280,
    max_frames: int = 1800,
    ffmpeg_path: str | None = None,
    max_duration_seconds: float = MAX_MEDIA_DURATION_SECONDS,
    sampling_mode: str = "fixed",
    scene_threshold: float = 0.25,
) -> list[dict[str, Any]]:
    """Extract JPEG frames at fixed ``fps`` or adaptive ``hybrid`` scene intervals.

    Returns a list of ``{timestamp, path}`` entries sorted chronologically.
    """
    ffmpeg = _ffmpeg_path(ffmpeg_path)
    directory = Path(outdir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if sampling_mode != "hybrid":
        return _extract_fixed_frames(
            src,
            directory,
            fps=fps,
            max_width=max_width,
            max_frames=max_frames,
            ffmpeg=ffmpeg,
            max_duration_seconds=max_duration_seconds,
        )

    pattern = directory / "frame_%06d.jpg"
    for stale in directory.glob("frame_*.jpg"):
        stale.unlink(missing_ok=True)
    input_args, input_path = media_input_args(src)
    proc = _run(
        [
            ffmpeg,
            "-y",
            "-nostdin",
            *input_args,
            "-t",
            f"{max_duration_seconds:g}",
            "-vf",
            build_hybrid_filter(fps, max_width, scene_threshold),
            "-fps_mode",
            "vfr",
            "-frames:v",
            str(max(1, max_frames)),
            "-q:v",
            "3",
            str(pattern),
        ],
        input_path=input_path,
    )
    if proc.returncode != 0:
        raise TransientFailure(f"frame extraction failed: {proc.stderr.strip()[-300:]}")
    files = sorted(directory.glob("frame_*.jpg"))
    if not files:
        return _extract_fixed_frames(
            src,
            directory,
            fps=fps,
            max_width=max_width,
            max_frames=max_frames,
            ffmpeg=ffmpeg,
            max_duration_seconds=max_duration_seconds,
        )
    pts = parse_showinfo_timestamps(proc.stderr)
    safe_fps = max(float(fps), 1e-4)
    return [
        {
            "timestamp": round(
                pts[index] if index < len(pts) else float(index) / safe_fps,
                3,
            ),
            "path": file_path,
        }
        for index, file_path in enumerate(files)
    ]


def extract_image_frame(
    src: str | Path,
    dst: str | Path,
    *,
    max_width: int = 1280,
    ffmpeg_path: str | None = None,
) -> dict[str, Any]:
    """Normalize one still image into the JPEG frame used by vision/OCR.

    Static image inputs have no duration, so the video ``fps`` filter emits
    no packet. ``-frames:v 1`` converts the first decoded image directly;
    the scale expression bounds the long edge without changing aspect ratio.
    FFmpeg autorotates decoded frames by default; keeping ``-autorotate``
    before the input would fail on FFmpeg 6.1 because it is output-only.
    """
    ffmpeg = _ffmpeg_path(ffmpeg_path)
    destination = Path(dst).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.unlink(missing_ok=True)
    scale = _bounded_scale(max_width)
    # geq exposes alpha and colour channels as 0..255 integers. Alpha needs
    # an 8-bit weighted average, not a 0..1 mix: opaque pixels retain their
    # colour and transparent pixels become white before JPEG encoding.
    flatten = (
        "format=rgba,"
        "geq="
        "r='(r(X,Y)*alpha(X,Y)+255*(255-alpha(X,Y)))/255':"
        "g='(g(X,Y)*alpha(X,Y)+255*(255-alpha(X,Y)))/255':"
        "b='(b(X,Y)*alpha(X,Y)+255*(255-alpha(X,Y)))/255':"
        "a=255,"
        "format=yuv420p"
    )
    input_args, input_path = media_input_args(src)
    proc = _run(
        [
            ffmpeg,
            "-y",
            "-nostdin",
            *input_args,
            "-frames:v",
            "1",
            "-vf",
            f"{scale},{flatten}",
            "-map_metadata",
            "-1",
            # The MJPEG muxer otherwise adds a Lavc encoder comment even after
            # input metadata is dropped. Bitexact mode also keeps output stable.
            "-flags",
            "+bitexact",
            "-update",
            "1",
            "-q:v",
            "3",
            str(destination),
        ],
        input_path=input_path,
    )
    if proc.returncode != 0 or not destination.is_file() or destination.stat().st_size == 0:
        detail = proc.stderr.strip()[-300:] if proc.stderr else "no output frame"
        raise PermanentFailure(f"image conversion failed: {detail}")
    return {"timestamp": 0.0, "path": destination}


def _bounded_scale(max_edge: int) -> str:
    """Scale the long edge while bounding both wide and tall inputs."""
    edge = max(1, int(max_edge))
    return (
        f"scale='if(gte(iw,ih),min({edge},iw),-2)':"
        f"'if(gte(iw,ih),-2,min({edge},ih))'"
    )
