"""Bounded subprocess execution for parsing untrusted media.

Media tools run in a new process group, inherit only an explicit source file
descriptor, receive an environment allow-list, execute in a temporary working
directory, and apply OS resource limits before execing the real binary.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

INPUT_FD_PLACEHOLDER = "{opencontext_input_fd}"
POSIX = os.name == "posix"


class SandboxTimeout(TimeoutError):
    """A sandboxed command exceeded its hard wall-clock limit."""


@dataclass(frozen=True)
class ResourceLimits:
    cpu_seconds: int
    memory_bytes: int
    file_size_bytes: int
    process_count: int
    timeout_seconds: float
    open_files: int = 64


# FFmpeg already runs with multiple decode/encode threads, so keep a generous
# per-process ceiling while still bounding a malicious media parser.
FFMPEG_LIMITS = ResourceLimits(
    cpu_seconds=240,
    memory_bytes=2 * 1024**3,
    file_size_bytes=2 * 1024**3,
    process_count=4096,
    timeout_seconds=300,
)
PROBE_LIMITS = ResourceLimits(
    cpu_seconds=30,
    memory_bytes=512 * 1024**2,
    file_size_bytes=64 * 1024**2,
    process_count=4096,
    timeout_seconds=30,
    open_files=32,
)
PDF_LIMITS = ResourceLimits(
    cpu_seconds=120,
    memory_bytes=2 * 1024**3,
    file_size_bytes=512 * 1024**2,
    process_count=4096,
    timeout_seconds=180,
    open_files=64,
)
TESSERACT_LIMITS = ResourceLimits(
    cpu_seconds=25,
    memory_bytes=768 * 1024**2,
    file_size_bytes=64 * 1024**2,
    process_count=4096,
    timeout_seconds=30,
    open_files=32,
)

_SAFE_ENV_KEYS = (
    "PATH",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
)


def supports_fd_input() -> bool:
    """Return whether the platform can pass a seekable source descriptor."""
    return POSIX


def media_input_args(source: str | Path) -> tuple[list[str], Path | None]:
    """Build input arguments plus the file used for descriptor passing.

    POSIX receives the source through one inherited descriptor and allows only
    FFmpeg's ``fd`` protocol. Nested playlists therefore cannot open arbitrary
    ``file:`` paths or network resources. Windows lacks ``pass_fds``, so it
    retains the existing path-based fallback with demuxer safe mode enabled.
    """
    if supports_fd_input():
        return (
            [
                "-protocol_whitelist",
                "fd",
                "-fd",
                INPUT_FD_PLACEHOLDER,
                "-i",
                "fd:",
            ],
            Path(source).resolve(),
        )
    return (
        [
            "-safe",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(Path(source).resolve()),
        ],
        None,
    )


def resolve_executable(command: str) -> Path:
    """Resolve a configured executable without invoking a shell."""
    candidate = Path(command).expanduser()
    if candidate.is_file():
        return candidate.resolve()
    resolved = None if candidate.parent != Path(".") else _which(command)
    if resolved is None:
        raise FileNotFoundError(command)
    return Path(resolved).resolve()


def _which(command: str) -> str | None:
    from shutil import which

    return which(command)


def _scrubbed_environment(workdir: Path) -> dict[str, str]:
    env = {key: os.environ[key] for key in _SAFE_ENV_KEYS if key in os.environ}
    env.update(
        {
            "HOME": str(workdir),
            "TMPDIR": str(workdir),
            "TEMP": str(workdir),
            "TMP": str(workdir),
            "XDG_CACHE_HOME": str(workdir / ".cache"),
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUTF8": "1",
            "OPENCONTEXT_SKIP_DOTENV": "1",
        }
    )
    return env


def _replace_input_descriptor(args: Sequence[str], descriptor: int) -> list[str]:
    return [
        str(arg).replace(INPUT_FD_PLACEHOLDER, str(descriptor)) for arg in args
    ]


def _kill_process_group(process: subprocess.Popen[Any]) -> None:
    try:
        if POSIX:
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except (ProcessLookupError, PermissionError):
        return


def run_sandboxed(
    args: Sequence[str],
    *,
    limits: ResourceLimits,
    input_path: str | Path | None = None,
    input_data: bytes | None = None,
    text: bool = False,
) -> subprocess.CompletedProcess[Any]:
    """Run one command with process-group, environment, filesystem, and rlimits.

    ``input_path`` is opened in the parent and passed as one explicit descriptor.
    The command can include ``INPUT_FD_PLACEHOLDER`` to receive its number. No
    other descriptors or parent environment variables survive into the child.
    """
    if input_path is not None and input_data is not None:
        raise ValueError("pass input_path or input_data, not both")
    if limits.timeout_seconds <= 0:
        raise ValueError("timeout_seconds must be positive")

    input_file = None
    descriptor: int | None = None
    pass_fds: tuple[int, ...] = ()
    try:
        if input_path is not None:
            input_file = Path(input_path).open("rb")
            descriptor = input_file.fileno()
            pass_fds = (descriptor,)

        needs_descriptor = any(
            INPUT_FD_PLACEHOLDER in str(arg) for arg in args
        )
        if needs_descriptor and descriptor is None:
            raise ValueError("input descriptor placeholder used without input_path")
        expanded = _replace_input_descriptor(args, descriptor or 0)

        with tempfile.TemporaryDirectory(prefix="oc-sandbox-") as temporary:
            workdir = Path(temporary)
            environment = _scrubbed_environment(workdir)
            if POSIX:
                command = [
                    sys.executable,
                    "-m",
                    "oc_worker.process_sandbox_exec",
                    json.dumps(asdict(limits), separators=(",", ":")),
                    "--",
                    *expanded,
                ]
            else:
                command = expanded
            kwargs: dict[str, Any] = {
                "cwd": workdir,
                "env": environment,
                "stdin": subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "close_fds": True,
            }
            if POSIX:
                kwargs.update({"pass_fds": pass_fds, "start_new_session": True})
            process = subprocess.Popen(command, **kwargs)
            try:
                stdout, stderr = process.communicate(
                    input=input_data,
                    timeout=limits.timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                _kill_process_group(process)
                process.communicate()
                raise SandboxTimeout(
                    f"sandboxed command exceeded {limits.timeout_seconds:g}s"
                ) from exc

        if text:
            decoded_stdout = stdout.decode("utf-8", errors="replace")
            decoded_stderr = stderr.decode("utf-8", errors="replace")
        else:
            decoded_stdout = stdout
            decoded_stderr = stderr
        return subprocess.CompletedProcess(
            expanded,
            process.returncode,
            decoded_stdout,
            decoded_stderr,
        )
    finally:
        if input_file is not None:
            input_file.close()
