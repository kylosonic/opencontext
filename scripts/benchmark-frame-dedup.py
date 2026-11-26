#!/usr/bin/env python3
"""Measure fixed, raw hybrid, and hybrid-plus-deduplication frame counts."""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw
from PIL import __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "workers" / "processor" / "src"))

from oc_worker.config import resolve_ffmpeg_path  # noqa: E402
from oc_worker.ffmpeg import extract_frames  # noqa: E402
from oc_worker.frame_dedup import (  # noqa: E402
    deduplicate_similar_frames,
    fingerprint_frame,
    pixel_rms,
)

WIDTH = 640
HEIGHT = 360
FPS = 10
SLIDE_SECONDS = 4
SLIDE_COUNT = 4
SLIDES = (
    ((18, 42, 76), (255, 255, 255), "LOGIN"),
    ((22, 92, 68), (255, 255, 255), "DASHBOARD"),
    ((126, 72, 24), (255, 255, 255), "SETTINGS"),
    ((76, 42, 112), (255, 255, 255), "EXPORT"),
)


def _slide_frame(index: int) -> Image.Image:
    background, foreground, title = SLIDES[index // (FPS * SLIDE_SECONDS)]
    frame = Image.new("RGB", (WIDTH, HEIGHT), background)
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle((40, 46, WIDTH - 40, HEIGHT - 46), radius=18, fill=(242, 244, 247))
    draw.text((72, 76), title, fill=(20, 28, 38))
    draw.rectangle((72, 124, 300, 140), fill=foreground)
    draw.rectangle((72, 166, 420, 196), outline=(90, 100, 112), width=2)
    draw.rectangle((72, 222, 250, 258), fill=(38, 112, 180))
    # This tiny moving marker creates low-energy inter-frame change so the raw
    # interval sampler emits candidates without creating meaningful evidence.
    marker_x = 72 + (index % (FPS * SLIDE_SECONDS)) * 8
    draw.rectangle((marker_x, 320, marker_x + 2, 322), fill=(252, 232, 92))
    return frame


def _generate_video(path: Path) -> None:
    ffmpeg = resolve_ffmpeg_path()
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        f"{WIDTH}x{HEIGHT}",
        "-framerate",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        str(path),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for index in range(FPS * SLIDE_SECONDS * SLIDE_COUNT):
            process.stdin.write(_slide_frame(index).tobytes())
        process.stdin.close()
    except BrokenPipeError:
        pass
    stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
    if process.wait() != 0:
        raise RuntimeError(f"benchmark video generation failed: {stderr[-500:]}")


def _timed_extract(
    *, sampling_mode: str, source: Path, directory: Path
) -> tuple[list[dict], float]:
    started = time.perf_counter()
    frames = extract_frames(
        source,
        directory,
        fps=1.0,
        max_width=1280,
        max_frames=60,
        sampling_mode=sampling_mode,
        scene_threshold=0.25,
    )
    return frames, round((time.perf_counter() - started) * 1000, 1)


def _slide_id(timestamp: float) -> int:
    return min(SLIDE_COUNT - 1, int(timestamp // SLIDE_SECONDS))


def _removed_neighbour_rms(frames: list[dict], removed: set[float]) -> float | None:
    if not frames:
        return None
    previous = fingerprint_frame(frames[0]["path"])
    values: list[float] = []
    for frame in frames[1:]:
        current = fingerprint_frame(frame["path"])
        if round(float(frame["timestamp"]), 3) in removed:
            values.append(pixel_rms(previous.rgb_pixels, current.rgb_pixels))
        else:
            previous = current
    return round(max(values), 4) if values else None


def _ffmpeg_version() -> str:
    result = subprocess.run(
        [resolve_ffmpeg_path(), "-version"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.splitlines()[0] if result.stdout else "unknown"


def run(out: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="opencontext-frame-benchmark-") as temp:
        work = Path(temp)
        video = work / "static-slides.mp4"
        _generate_video(video)

        fixed, fixed_ms = _timed_extract(
            sampling_mode="fixed", source=video, directory=work / "fixed"
        )
        raw_hybrid, raw_ms = _timed_extract(
            sampling_mode="hybrid", source=video, directory=work / "hybrid"
        )
        dedup_started = time.perf_counter()
        dedup = deduplicate_similar_frames(raw_hybrid)
        dedup_ms = round((time.perf_counter() - dedup_started) * 1000, 1)

        removed = set(dedup.removed_timestamps)
        raw_slides = {_slide_id(float(frame["timestamp"])) for frame in raw_hybrid}
        kept_slides = {_slide_id(float(frame["timestamp"])) for frame in dedup.frames}
        expected_timestamps = [0.0] + [
            float(index * SLIDE_SECONDS) for index in range(1, SLIDE_COUNT)
        ]
        kept_timestamps = [float(frame["timestamp"]) for frame in dedup.frames]
        calls_saved = len(raw_hybrid) - len(dedup.frames)

        report = {
            "runDate": date.today().isoformat(),
            "scope": "synthetic static slide video with four visual states",
            "environment": {
                "ffmpeg": _ffmpeg_version(),
                "python": platform.python_version(),
                "pillow": pillow_version,
            },
            "input": {
                "durationSec": SLIDE_SECONDS * SLIDE_COUNT,
                "fps": FPS,
                "resolution": f"{WIDTH}x{HEIGHT}",
                "visualStates": SLIDE_COUNT,
                "animation": "2px marker moving within each static slide",
            },
            "thresholds": {
                "sceneChange": 0.25,
                "differenceHashDistance": 2,
                "pixelRms": 1.25,
            },
            "fixed": {
                "frameCount": len(fixed),
                "visionCalls": len(fixed),
                "timestamps": [float(frame["timestamp"]) for frame in fixed],
                "elapsedMs": fixed_ms,
            },
            "rawHybrid": {
                "frameCount": len(raw_hybrid),
                "visionCalls": len(raw_hybrid),
                "timestamps": [float(frame["timestamp"]) for frame in raw_hybrid],
                "elapsedMs": raw_ms,
            },
            "hybridDedup": {
                "frameCount": len(dedup.frames),
                "visionCalls": len(dedup.frames),
                "timestamps": kept_timestamps,
                "fingerprintErrors": dedup.fingerprint_errors,
                "dedupElapsedMs": dedup_ms,
                "visionCallsSavedVsRawHybrid": calls_saved,
                "visionCallReductionPct": round(100 * calls_saved / len(raw_hybrid), 2)
                if raw_hybrid
                else 0.0,
                "visionCallsSavedVsFixed": len(fixed) - len(dedup.frames),
                "removedTimestamps": dedup.removed_timestamps,
                "maxRemovedNeighbourRms": _removed_neighbour_rms(raw_hybrid, removed),
            },
            "evidence": {
                "rawSlideIds": sorted(raw_slides),
                "retainedSlideIds": sorted(kept_slides),
                "allSlideLabelsRepresented": kept_slides == set(range(SLIDE_COUNT)),
                "sceneBoundariesRetained": all(
                    timestamp in kept_timestamps for timestamp in expected_timestamps
                ),
                "firstAndFinalRetained": bool(kept_timestamps)
                and kept_timestamps[0] == float(raw_hybrid[0]["timestamp"])
                and kept_timestamps[-1] == float(raw_hybrid[-1]["timestamp"]),
                "ocrClaim": (
                    "not measured; Tesseract was not required for this "
                    "frame-count benchmark"
                ),
            },
            "limits": [
                "Counts assume one vision and one OCR request per retained frame.",
                "The benchmark measures extraction and fingerprint overhead, not provider latency.",
                "The video and labels are synthetic and do not establish general model quality.",
            ],
        }
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "docs" / "performance" / f"frame-dedup-{date.today().isoformat()}.json",
    )
    args = parser.parse_args()
    report = run(args.out)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
