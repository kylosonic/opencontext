"""Tests for adaptive hybrid scene-change frame extraction."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

import oc_worker.ffmpeg as ffmpeg_module
from oc_worker.config import Settings, resolve_ffmpeg_path


def test_clamp_scene_threshold_and_build_hybrid_filter() -> None:
    assert ffmpeg_module.clamp_scene_threshold(0.01) == 0.05
    assert ffmpeg_module.clamp_scene_threshold(1.5) == 0.95
    assert ffmpeg_module.clamp_scene_threshold(0.3) == 0.3

    filter_expr = ffmpeg_module.build_hybrid_filter(
        fps=0.5, max_width=1280, scene_threshold=0.25
    )
    assert (
        "select='eq(n,0)+gt(scene,0.25)+isnan(prev_selected_t)"
        "+gte(t-prev_selected_t,2.0)'"
    ) in filter_expr
    assert "showinfo" in filter_expr
    assert "1280" in filter_expr


def test_parse_showinfo_timestamps_extracts_ordered_seconds() -> None:
    stderr = """
[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0       fmt:yuv420p
[Parsed_showinfo_1 @ 0x1] n:   1 pts:  13500 pts_time:1.35    fmt:yuv420p
[Parsed_showinfo_1 @ 0x1] n:   2 pts:  30000 pts_time: 3.005  fmt:yuv420p
"""
    assert ffmpeg_module.parse_showinfo_timestamps(stderr) == [0.0, 1.35, 3.005]


def test_settings_loads_and_clamps_sampling_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRAME_SAMPLING_MODE", "hybrid")
    monkeypatch.setenv("SCENE_CHANGE_THRESHOLD", "2.5")
    settings = Settings.from_env()
    assert settings.frame_sampling_mode == "hybrid"
    assert settings.scene_change_threshold == 0.95

    monkeypatch.setenv("FRAME_SAMPLING_MODE", "unexpected")
    monkeypatch.setenv("SCENE_CHANGE_THRESHOLD", "-1.0")
    fallback = Settings.from_env()
    assert fallback.frame_sampling_mode == "fixed"
    assert fallback.scene_change_threshold == 0.05


def test_hybrid_falls_back_to_fixed_when_select_produces_zero_frames(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[list[str]] = []
    outdir = tmp_path / "frames"

    def fake_run(args: list[str], **_kwargs) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if "-fps_mode" in args:
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / "frame_000001.jpg").write_bytes(b"jpg-1")
        (outdir / "frame_000002.jpg").write_bytes(b"jpg-2")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(ffmpeg_module, "_run", fake_run)
    frames = ffmpeg_module.extract_frames(
        "clip.mp4",
        outdir,
        fps=1.0,
        sampling_mode="hybrid",
        scene_threshold=0.25,
    )

    assert len(calls) == 2
    assert "-fps_mode" in calls[0]
    assert "-fps_mode" not in calls[1]
    assert [frame["timestamp"] for frame in frames] == [0.0, 1.0]


def test_hybrid_captures_real_scene_cut_with_ffmpeg(tmp_path: Path) -> None:
    ffmpeg_bin = resolve_ffmpeg_path()
    if not Path(ffmpeg_bin).is_file() and shutil.which(ffmpeg_bin) is None:
        pytest.skip("ffmpeg binary not installed")

    clip = tmp_path / "scene_cut.mp4"
    gen = subprocess.run(
        [
            ffmpeg_bin,
            "-y",
            "-nostdin",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=160x90:d=1.5",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=160x90:d=1.5",
            "-filter_complex",
            "[0:v][1:v]concat=n=2:v=1[v]",
            "-map",
            "[v]",
            "-r",
            "10",
            "-pix_fmt",
            "yuv420p",
            str(clip),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if gen.returncode != 0:
        pytest.skip(f"lavfi synthetic video generation unavailable: {gen.stderr[-120:]}")

    frames = ffmpeg_module.extract_frames(
        clip,
        tmp_path / "out",
        fps=0.2,
        ffmpeg_path=ffmpeg_bin,
        sampling_mode="hybrid",
        scene_threshold=0.25,
    )
    timestamps = [frame["timestamp"] for frame in frames]
    assert timestamps[0] == 0.0
    assert any(1.2 <= ts <= 1.8 for ts in timestamps), timestamps
