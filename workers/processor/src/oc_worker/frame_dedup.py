"""Conservative perceptual de-duplication for adaptively sampled video frames."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

_PIXEL_SIZE = (64, 64)
_HASH_SIZE = (9, 8)
_FINGERPRINT_ERRORS = (
    OSError,
    SyntaxError,
    ValueError,
    Image.DecompressionBombError,
)


@dataclass(frozen=True)
class FrameFingerprint:
    rgb_pixels: bytes
    difference_hash: int


@dataclass(frozen=True)
class DedupResult:
    frames: list[dict[str, Any]]
    removed_timestamps: list[float]
    fingerprint_errors: int = 0

    @property
    def removed_count(self) -> int:
        return len(self.removed_timestamps)


def fingerprint_frame(path: str | Path) -> FrameFingerprint:
    """Build a colour fingerprint and a grayscale perceptual hash."""
    with Image.open(path) as image:
        grayscale = image.convert("L")
        rgb_pixels = (
            image.convert("RGB").resize(_PIXEL_SIZE, Image.Resampling.BILINEAR).tobytes()
        )
        hash_pixels = grayscale.resize(
            _HASH_SIZE, Image.Resampling.BILINEAR
        ).tobytes()

    bits = 0
    bit_index = 0
    width, height = _HASH_SIZE
    for row in range(height):
        offset = row * width
        for column in range(width - 1):
            if hash_pixels[offset + column] > hash_pixels[offset + column + 1]:
                bits |= 1 << bit_index
            bit_index += 1
    return FrameFingerprint(rgb_pixels=rgb_pixels, difference_hash=bits)


def hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def pixel_rms(left: bytes, right: bytes) -> float:
    if len(left) != len(right) or not left:
        return math.inf
    squared = sum((a - b) ** 2 for a, b in zip(left, right, strict=True))
    return math.sqrt(squared / len(left))


def is_near_duplicate(
    previous: FrameFingerprint,
    current: FrameFingerprint,
    *,
    max_hash_distance: int = 2,
    max_rms: float = 1.25,
) -> bool:
    """Return true only when both perceptual and pixel checks are close."""
    return (
        hamming_distance(previous.difference_hash, current.difference_hash)
        <= max(0, min(16, int(max_hash_distance)))
        and pixel_rms(previous.rgb_pixels, current.rgb_pixels)
        <= max(0.0, min(32.0, float(max_rms)))
    )


def deduplicate_similar_frames(
    frames: list[dict[str, Any]],
    *,
    max_hash_distance: int = 2,
    max_rms: float = 1.25,
) -> DedupResult:
    """Remove only near-identical adjacent frames before vision calls.

    The first and final frames are always retained so a long static segment
    still preserves its boundaries. A frame that cannot be fingerprinted is
    retained, and comparison resumes from the following frame. This fails open:
    de-duplication must never make otherwise analyzable evidence disappear.
    """
    if len(frames) <= 2:
        return DedupResult(frames=list(frames), removed_timestamps=[])

    kept = [frames[0]]
    removed_timestamps: list[float] = []
    errors = 0
    try:
        previous = fingerprint_frame(frames[0]["path"])
    except _FINGERPRINT_ERRORS:
        previous = None
        errors += 1

    final_index = len(frames) - 1
    for index, frame in enumerate(frames[1:], start=1):
        try:
            current = fingerprint_frame(frame["path"])
        except _FINGERPRINT_ERRORS:
            kept.append(frame)
            previous = None
            errors += 1
            continue

        if (
            index != final_index
            and previous is not None
            and is_near_duplicate(
                previous,
                current,
                max_hash_distance=max_hash_distance,
                max_rms=max_rms,
            )
        ):
            removed_timestamps.append(round(float(frame["timestamp"]), 3))
            continue

        kept.append(frame)
        previous = current

    return DedupResult(
        frames=kept,
        removed_timestamps=removed_timestamps,
        fingerprint_errors=errors,
    )
