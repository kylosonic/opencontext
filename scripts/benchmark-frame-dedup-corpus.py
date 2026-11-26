#!/usr/bin/env python3
"""Measure conservative frame de-duplication on real Screen2Words states."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps
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

WIDTH = 360
HEIGHT = 640
FPS = 5
SLIDE_SECONDS = 3
MAX_FRAMES = 60
SCENE_THRESHOLD = 0.25


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fit_screen(image: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), (244, 246, 248))
    foreground = ImageOps.exif_transpose(image).convert("RGB")
    foreground = ImageOps.contain(
        foreground,
        (WIDTH - 16, HEIGHT - 16),
        Image.Resampling.LANCZOS,
    )
    left = (WIDTH - foreground.width) // 2
    top = (HEIGHT - foreground.height) // 2
    canvas.paste(foreground, (left, top))
    return canvas


def _load_screens(corpus: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest_path = corpus / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    items = manifest.get("visual", {}).get("items", [])
    if not isinstance(items, list) or len(items) < 8:
        raise RuntimeError("expected at least eight Screen2Words images in the corpus")
    loaded: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        source = corpus / str(item["source"])
        if not source.is_file():
            raise RuntimeError(f"missing corpus image: {source}")
        actual_sha = _sha256(source)
        if item.get("sha256") and actual_sha != item["sha256"]:
            raise RuntimeError(f"corpus image hash mismatch: {source}")
        with Image.open(source) as image:
            frame = _fit_screen(image)
        loaded.append(
            {
                "index": index,
                "id": str(item["id"]),
                "source": str(item["source"]),
                "sha256": actual_sha,
                "frame": frame,
            }
        )
    return manifest, loaded


def _generate_video(path: Path, screens: list[dict[str, Any]]) -> None:
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
    if process.stdin is None:
        raise RuntimeError("could not open FFmpeg stdin")
    try:
        for screen in screens:
            raw = screen["frame"].tobytes()
            for _ in range(FPS * SLIDE_SECONDS):
                process.stdin.write(raw)
        process.stdin.close()
    except BrokenPipeError:
        pass
    stderr = (
        process.stderr.read().decode("utf-8", errors="replace")
        if process.stderr
        else ""
    )
    if process.wait() != 0:
        raise RuntimeError(f"FFmpeg video generation failed: {stderr[-500:]}")


def _timed_extract(
    *, sampling_mode: str, source: Path, directory: Path
) -> tuple[list[dict[str, Any]], float]:
    started = time.perf_counter()
    frames = extract_frames(
        source,
        directory,
        fps=1.0,
        max_width=1280,
        max_frames=MAX_FRAMES,
        sampling_mode=sampling_mode,
        scene_threshold=SCENE_THRESHOLD,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    return frames, elapsed_ms


def _state_id(timestamp: float, state_count: int) -> int:
    return min(state_count - 1, max(0, int(timestamp // SLIDE_SECONDS)))


def _removed_neighbour_rms(
    frames: list[dict[str, Any]], removed: set[float]
) -> float | None:
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


def run(corpus: Path, out: Path) -> dict[str, Any]:
    manifest, screens = _load_screens(corpus)
    state_count = len(screens)
    with tempfile.TemporaryDirectory(prefix="opencontext-real-frame-benchmark-") as temp:
        work = Path(temp)
        video = work / "screen2words-sequences.mp4"
        _generate_video(video, screens)
        fixed, fixed_ms = _timed_extract(
            sampling_mode="fixed", source=video, directory=work / "fixed"
        )
        raw_hybrid, raw_ms = _timed_extract(
            sampling_mode="hybrid", source=video, directory=work / "hybrid"
        )
        dedup_started = time.perf_counter()
        dedup = deduplicate_similar_frames(raw_hybrid)
        dedup_ms = round((time.perf_counter() - dedup_started) * 1000, 1)

        raw_states = {
            _state_id(float(frame["timestamp"]), state_count) for frame in raw_hybrid
        }
        kept_states = {
            _state_id(float(frame["timestamp"]), state_count) for frame in dedup.frames
        }
        removed = set(dedup.removed_timestamps)
        removed_states = {
            _state_id(timestamp, state_count) for timestamp in dedup.removed_timestamps
        }
        expected_states = set(range(state_count))
        lost_states = sorted((raw_states | expected_states) - kept_states)
        kept_timestamps = [float(frame["timestamp"]) for frame in dedup.frames]
        calls_saved = len(raw_hybrid) - len(dedup.frames)

        report = {
            "runDate": date.today().isoformat(),
            "scope": f"{state_count} real Screen2Words app-screenshot states",
            "measurementKind": "deterministic frame-selection benchmark with real images",
            "dataset": {
                "id": manifest.get("visual", {}).get("id"),
                "dataset": manifest.get("visual", {}).get("dataset"),
                "provenance": manifest.get("visual", {}).get("provenance"),
                "license": manifest.get("visual", {}).get("license"),
                "citation": manifest.get("visual", {}).get("citation"),
                "stateCount": state_count,
                "states": [
                    {"id": screen["id"], "sha256": screen["sha256"]}
                    for screen in screens
                ],
            },
            "environment": {
                "ffmpeg": _ffmpeg_version(),
                "python": platform.python_version(),
                "pillow": pillow_version,
            },
            "input": {
                "durationSec": SLIDE_SECONDS * state_count,
                "fps": FPS,
                "resolution": f"{WIDTH}x{HEIGHT}",
                "secondsPerState": SLIDE_SECONDS,
            },
            "thresholds": {
                "sceneChange": SCENE_THRESHOLD,
                "differenceHashDistance": 2,
                "pixelRms": 1.25,
            },
            "fixed": {
                "frameCount": len(fixed),
                "visionCalls": len(fixed),
                "elapsedMs": fixed_ms,
            },
            "rawHybrid": {
                "frameCount": len(raw_hybrid),
                "visionCalls": len(raw_hybrid),
                "stateCount": len(raw_states),
                "elapsedMs": raw_ms,
            },
            "hybridDedup": {
                "frameCount": len(dedup.frames),
                "visionCalls": len(dedup.frames),
                "stateCount": len(kept_states),
                "timestamps": kept_timestamps,
                "fingerprintErrors": dedup.fingerprint_errors,
                "dedupElapsedMs": dedup_ms,
                "visionCallsSavedVsRawHybrid": calls_saved,
                "visionCallReductionPct": round(100 * calls_saved / len(raw_hybrid), 2)
                if raw_hybrid
                else 0.0,
                "removedTimestamps": dedup.removed_timestamps,
                "removedStateIds": sorted(removed_states),
                "maxRemovedNeighbourRms": _removed_neighbour_rms(raw_hybrid, removed),
            },
            "evidence": {
                "expectedStateIds": sorted(expected_states),
                "rawStateIds": sorted(raw_states),
                "retainedStateIds": sorted(kept_states),
                "lostStateIds": lost_states,
                "allRealScreenshotStatesRepresented": not lost_states,
                "firstAndFinalRetained": bool(kept_timestamps)
                and kept_timestamps[0] == float(raw_hybrid[0]["timestamp"])
                and kept_timestamps[-1] == float(raw_hybrid[-1]["timestamp"]),
                "ocrClaim": "not measured; retained-state coverage is the evidence gate",
            },
            "limits": [
                "The source is a curated sequence of 16 real screenshots, "
                "not a timed screen recording.",
                "State coverage checks visual-state removal, not OCR or hosted-model quality.",
                "Counts assume one vision and one OCR request per retained frame.",
                "Wall-clock values are one local run and are not provider latency measurements.",
            ],
        }
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--corpus",
        type=Path,
        default=ROOT / ".artifacts" / "heldout-frame-dedup",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT
        / "docs"
        / "performance"
        / f"frame-dedup-screen2words-{date.today().isoformat()}.json",
    )
    parser.add_argument(
        "--require-no-loss",
        action="store_true",
        help="Exit nonzero if de-duplication loses a represented real-screenshot state.",
    )
    args = parser.parse_args()
    report = run(args.corpus.resolve(), args.out.resolve())
    print(json.dumps(report, indent=2))
    if args.require_no_loss and not report["evidence"][
        "allRealScreenshotStatesRepresented"
    ]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
