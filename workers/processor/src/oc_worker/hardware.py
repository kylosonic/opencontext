"""Local GPU/accelerator detection and Faster Whisper device selection."""

from __future__ import annotations

import importlib
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass

VALID_WORKER_DEVICES = ("auto", "cpu", "cuda")
VALID_WHISPER_COMPUTE_TYPES = (
    "auto",
    "int8",
    "int8_float16",
    "int16",
    "float16",
    "float32",
    "default",
)


@dataclass(frozen=True)
class HardwareInfo:
    accelerator: str
    cuda_device_count: int
    detail: str


def _detect_cuda_count_via_ctranslate2() -> int | None:
    try:
        ct2 = importlib.import_module("ctranslate2")
    except ImportError:
        return None
    getter = getattr(ct2, "get_cuda_device_count", None)
    if not callable(getter):
        return None
    try:
        count = int(getter())
        return max(0, count)
    except Exception:  # noqa: BLE001
        return 0


def _detect_cuda_count_via_nvidia_smi() -> int:
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return 0
    try:
        completed = subprocess.run(
            [nvidia_smi, "-L"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return 0
    if completed.returncode != 0:
        return 0
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    return len(lines)


def detect_hardware() -> HardwareInfo:
    """Detect local compute accelerators without requiring heavy ML imports."""
    ct2_cuda = _detect_cuda_count_via_ctranslate2()
    cuda_count = (
        ct2_cuda if ct2_cuda is not None and ct2_cuda > 0 else _detect_cuda_count_via_nvidia_smi()
    )
    if cuda_count > 0:
        return HardwareInfo(
            accelerator="cuda",
            cuda_device_count=cuda_count,
            detail=f"CUDA available ({cuda_count} GPU device(s))",
        )
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return HardwareInfo(
            accelerator="mps",
            cuda_device_count=0,
            detail="Apple Silicon (ARM64)",
        )
    return HardwareInfo(
        accelerator="cpu",
        cuda_device_count=0,
        detail="CPU inference (no CUDA GPU detected)",
    )


def resolve_whisper_device(
    requested_device: str = "auto",
    requested_compute_type: str = "auto",
    hardware: HardwareInfo | None = None,
) -> tuple[str, str]:
    """Resolve effective `(device, compute_type)` for Faster Whisper."""
    device = (requested_device or "auto").strip().lower()
    if device not in VALID_WORKER_DEVICES:
        raise ValueError(
            f"Invalid WORKER_DEVICE={requested_device!r}; "
            f"expected one of {', '.join(VALID_WORKER_DEVICES)}"
        )

    compute = (requested_compute_type or "auto").strip().lower()
    if compute not in VALID_WHISPER_COMPUTE_TYPES:
        raise ValueError(
            f"Invalid WHISPER_COMPUTE_TYPE={requested_compute_type!r}; "
            f"expected one of {', '.join(VALID_WHISPER_COMPUTE_TYPES)}"
        )

    info = hardware or detect_hardware()
    resolved_device = (
        "cuda" if (device == "auto" and info.cuda_device_count > 0) else "cpu"
        if device == "auto"
        else device
    )
    resolved_compute = (
        ("float16" if resolved_device == "cuda" else "int8")
        if compute == "auto"
        else compute
    )
    return resolved_device, resolved_compute
