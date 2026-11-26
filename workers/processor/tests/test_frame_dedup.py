"""Conservative perceptual de-duplication before video vision calls."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from oc_worker.config import Settings
from oc_worker.frame_dedup import (
    deduplicate_similar_frames,
    fingerprint_frame,
    hamming_distance,
    is_near_duplicate,
    pixel_rms,
)


def _write_jpeg(path: Path, colour: tuple[int, int, int]) -> Path:
    Image.new("RGB", (96, 54), colour).save(path, format="JPEG", quality=95)
    return path


def _frame(path: Path, timestamp: float) -> dict[str, object]:
    return {"path": str(path), "timestamp": timestamp}


def test_identical_adjacent_frames_are_removed_but_slide_boundaries_survive(
    tmp_path: Path,
) -> None:
    dark = _write_jpeg(tmp_path / "dark-1.jpg", (12, 20, 28))
    dark_copy = _write_jpeg(tmp_path / "dark-2.jpg", (12, 20, 28))
    light = _write_jpeg(tmp_path / "light-1.jpg", (238, 240, 242))
    light_copy = _write_jpeg(tmp_path / "light-2.jpg", (238, 240, 242))
    frames = [
        _frame(dark, 0.0),
        _frame(dark_copy, 1.0),
        _frame(light, 2.0),
        _frame(light_copy, 3.0),
    ]

    result = deduplicate_similar_frames(frames)

    assert [frame["timestamp"] for frame in result.frames] == [0.0, 2.0, 3.0]
    assert result.removed_timestamps == [1.0]
    assert result.fingerprint_errors == 0


def test_final_frame_is_always_retained_for_long_static_interval(
    tmp_path: Path,
) -> None:
    colours = [(20, 40, 60), (20, 40, 60), (20, 40, 60), (20, 40, 60)]
    frames = [
        _frame(_write_jpeg(tmp_path / f"static-{index}.jpg", colour), float(index))
        for index, colour in enumerate(colours)
    ]

    result = deduplicate_similar_frames(frames)

    assert [frame["timestamp"] for frame in result.frames] == [0.0, 3.0]
    assert result.removed_timestamps == [1.0, 2.0]


def test_real_colour_transition_is_not_removed(tmp_path: Path) -> None:
    black = fingerprint_frame(_write_jpeg(tmp_path / "black.jpg", (0, 0, 0)))
    white = fingerprint_frame(_write_jpeg(tmp_path / "white.jpg", (255, 255, 255)))

    assert pixel_rms(black.rgb_pixels, white.rgb_pixels) > 1.25
    assert not is_near_duplicate(black, white)


def test_equal_luminance_colour_transition_is_not_removed(tmp_path: Path) -> None:
    red = fingerprint_frame(_write_jpeg(tmp_path / "red.jpg", (255, 0, 0)))
    green = fingerprint_frame(_write_jpeg(tmp_path / "green.jpg", (0, 127, 0)))

    # Both solid colours have a nearly identical grayscale value, so a
    # grayscale-only pixel check could discard this meaningful state change.
    assert hamming_distance(red.difference_hash, green.difference_hash) == 0
    assert pixel_rms(red.rgb_pixels, green.rgb_pixels) > 1.25
    assert not is_near_duplicate(red, green)


def test_malformed_frames_fail_open_and_comparison_resumes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    valid_first = _write_jpeg(tmp_path / "valid-1.jpg", (10, 20, 30))
    malformed = tmp_path / "malformed.jpg"
    malformed.write_bytes(b"not-a-jpeg")
    valid_after = _write_jpeg(tmp_path / "valid-2.jpg", (40, 50, 60))
    valid_next = _write_jpeg(tmp_path / "valid-3.jpg", (40, 50, 60))
    valid_last = _write_jpeg(tmp_path / "valid-4.jpg", (90, 100, 110))
    frames = [
        _frame(valid_first, 0.0),
        _frame(malformed, 1.0),
        _frame(valid_after, 2.0),
        _frame(valid_next, 3.0),
        _frame(valid_last, 4.0),
    ]

    result = deduplicate_similar_frames(frames)

    assert [frame["timestamp"] for frame in result.frames] == [0.0, 1.0, 2.0, 4.0]
    assert result.removed_timestamps == [3.0]
    assert result.fingerprint_errors == 1


def test_two_or_fewer_frames_are_returned_without_decoding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    frames = [_frame(tmp_path / "missing-1.jpg", 0.0), _frame(tmp_path / "missing-2.jpg", 1.0)]

    def unexpected_fingerprint(_path: str | Path):
        raise AssertionError("small frame lists should not be decoded")

    monkeypatch.setattr("oc_worker.frame_dedup.fingerprint_frame", unexpected_fingerprint)

    result = deduplicate_similar_frames(frames)

    assert result.frames == frames
    assert result.removed_timestamps == []
    assert result.fingerprint_errors == 0


def test_frame_dedup_settings_are_clamped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRAME_DEDUP_HASH_DISTANCE", "999")
    monkeypatch.setenv("FRAME_DEDUP_PIXEL_RMS", "-10")

    high = Settings.from_env()
    assert high.frame_dedup_hash_distance == 16
    assert high.frame_dedup_pixel_rms == 0.0

    monkeypatch.setenv("FRAME_DEDUP_HASH_DISTANCE", "-1")
    monkeypatch.setenv("FRAME_DEDUP_PIXEL_RMS", "999")

    low = Settings.from_env()
    assert low.frame_dedup_hash_distance == 0
    assert low.frame_dedup_pixel_rms == 32.0

    monkeypatch.setenv("FRAME_DEDUP_HASH_DISTANCE", "invalid")
    monkeypatch.setenv("FRAME_DEDUP_PIXEL_RMS", "invalid")

    defaults = Settings.from_env()
    assert defaults.frame_dedup_hash_distance == 2
    assert defaults.frame_dedup_pixel_rms == 1.25
