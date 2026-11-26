"""Hostile-media and resource-isolation coverage for extraction boundaries."""

from __future__ import annotations

import json
import shutil
import struct
import sys
import time
import zlib
from pathlib import Path

import pytest
from PIL import Image

import oc_worker.ffmpeg as ffmpeg_module
from oc_worker.cli import analyze_file
from oc_worker.config import Settings, resolve_ffmpeg_path
from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.pdf import extract_pdf_pages
from oc_worker.process_sandbox import (
    INPUT_FD_PLACEHOLDER,
    ResourceLimits,
    SandboxTimeout,
    run_sandboxed,
)

FFMPEG = resolve_ffmpeg_path()
FFMPEG_AVAILABLE = Path(FFMPEG).is_file() or shutil.which(FFMPEG) is not None


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)


def _compressed_png(path: Path, width: int, height: int) -> None:
    compressor = zlib.compressobj(level=9)
    row = b"\0" + b"\0" * (width * 3)
    compressed = [compressor.compress(row) for _ in range(height)]
    compressed.append(compressor.flush())
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(
            b"IHDR",
            struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0),
        )
        + _png_chunk(b"IDAT", b"".join(compressed))
        + _png_chunk(b"IEND", b"")
    )


def test_sandbox_scrubs_environment_and_applies_resource_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-reach-child")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "must-not-reach-child")
    monkeypatch.setenv("GITHUB_TOKEN", "must-not-reach-child")
    limits = ResourceLimits(
        cpu_seconds=5,
        memory_bytes=512 * 1024**2,
        file_size_bytes=8 * 1024**2,
        process_count=4096,
        timeout_seconds=10,
        open_files=32,
    )
    script = """\
import json, os, resource
print(json.dumps({
  "cwd": os.getcwd(),
  "env": sorted(os.environ),
  "cpu": resource.getrlimit(resource.RLIMIT_CPU)[0],
  "memory": resource.getrlimit(resource.RLIMIT_AS)[0],
  "file": resource.getrlimit(resource.RLIMIT_FSIZE)[0],
  "processes": resource.getrlimit(resource.RLIMIT_NPROC)[0],
  "files": resource.getrlimit(resource.RLIMIT_NOFILE)[0],
}))
"""
    result = run_sandboxed(
        [sys.executable, "-c", script],
        limits=limits,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    observed = json.loads(result.stdout)
    assert "OPENAI_API_KEY" not in observed["env"]
    assert "AWS_SECRET_ACCESS_KEY" not in observed["env"]
    assert "GITHUB_TOKEN" not in observed["env"]
    assert observed["cpu"] <= limits.cpu_seconds
    assert observed["memory"] == limits.memory_bytes
    assert observed["file"] == limits.file_size_bytes
    assert observed["processes"] == limits.process_count
    assert observed["files"] == limits.open_files
    assert not Path(observed["cwd"]).exists(), "temporary working directory was retained"


def test_sandbox_passes_only_the_requested_input_descriptor(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"descriptor-data")
    script = "import os, sys; print(os.read(int(sys.argv[1]), 15).decode())"
    limits = ResourceLimits(
        cpu_seconds=5,
        memory_bytes=512 * 1024**2,
        file_size_bytes=8 * 1024**2,
        process_count=4096,
        timeout_seconds=10,
    )

    result = run_sandboxed(
        [sys.executable, "-c", script, INPUT_FD_PLACEHOLDER],
        limits=limits,
        input_path=source,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "descriptor-data"


def test_sandbox_hard_timeout_kills_the_command(monkeypatch: pytest.MonkeyPatch) -> None:
    limits = ResourceLimits(
        cpu_seconds=5,
        memory_bytes=512 * 1024**2,
        file_size_bytes=8 * 1024**2,
        process_count=4096,
        timeout_seconds=0.25,
    )
    started = time.monotonic()
    with pytest.raises(SandboxTimeout):
        run_sandboxed(
            [sys.executable, "-c", "import time; time.sleep(10)"],
            limits=limits,
        )
    assert time.monotonic() - started < 3


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg is not installed")
@pytest.mark.parametrize(
    ("demuxer", "manifest_name", "body"),
    [
        (
            "concat",
            "hostile.ffconcat",
            "ffconcat version 1.0\nfile 'file://{target}'\n",
        ),
        (
            "hls",
            "hostile.m3u8",
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n"
            "#EXTINF:1,\nfile://{target}\n#EXT-X-ENDLIST\n",
        ),
    ],
)
def test_hostile_playlist_cannot_open_a_local_file(
    tmp_path: Path,
    demuxer: str,
    manifest_name: str,
    body: str,
) -> None:
    secret = "OPENCONTEXT-SECRET-MUST-NOT-BE-READ"
    target = tmp_path / "secret.ts"
    target.write_text(secret, encoding="utf-8")
    manifest = tmp_path / manifest_name
    manifest.write_text(body.format(target=target), encoding="utf-8")
    args = [
        FFMPEG,
        "-v",
        "error",
        "-nostdin",
        "-f",
        demuxer,
        "-safe",
        "0",
        "-protocol_whitelist",
        "fd",
        "-fd",
        INPUT_FD_PLACEHOLDER,
        "-i",
        "fd:",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
    ]

    result = ffmpeg_module._run(args, input_path=manifest)

    assert result.returncode != 0
    assert "not on whitelist 'fd'" in result.stderr
    assert secret not in result.stdout
    assert secret not in result.stderr


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg is not installed")
def test_truncated_video_fails_within_the_sandbox(tmp_path: Path) -> None:
    fixture = Path(__file__).resolve().parents[3] / ".artifacts" / "opencontext-fixture.mp4"
    if not fixture.is_file():
        pytest.skip("fixture video is not present")
    truncated = tmp_path / "truncated.mp4"
    truncated.write_bytes(fixture.read_bytes()[:128])

    with pytest.raises(TransientFailure):
        ffmpeg_module.extract_frames(truncated, tmp_path / "frames")


@pytest.mark.skipif(not FFMPEG_AVAILABLE, reason="ffmpeg is not installed")
def test_decompression_bomb_image_is_rejected_before_decoding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bomb = tmp_path / "bomb.png"
    _compressed_png(bomb, 7000, 7000)  # 49 megapixels, but only ~140 KiB on disk.
    monkeypatch.setenv("OPENCONTEXT_SKIP_DOTENV", "1")
    settings = Settings(
        ffmpeg_path=FFMPEG,
        transcription_provider="off",
        vision_provider="fixture",
        ocr_provider="off",
        text_provider="template",
    )

    with pytest.raises(PermanentFailure, match="40 megapixels"):
        analyze_file(bomb, settings)


def test_pdf_over_the_page_limit_is_rejected_in_the_helper_process(
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "oversized.pdf"
    pages = [Image.new("RGB", (32, 32), "white") for _ in range(31)]
    pages[0].save(pdf_path, save_all=True, append_images=pages[1:])

    with pytest.raises(PermanentFailure, match="limit is 30"):
        extract_pdf_pages(pdf_path, tmp_path / "pages")
