"""Apply resource limits and exec a command inside the isolated child."""

from __future__ import annotations

import json
import os
import resource
import sys
from collections.abc import Sequence

from oc_worker.process_sandbox import ResourceLimits


def _set_limit(name: int | None, soft: int, hard: int | None = None) -> None:
    if name is None:
        return
    requested_hard = soft if hard is None else hard
    _, current_hard = resource.getrlimit(name)
    if current_hard != resource.RLIM_INFINITY:
        requested_hard = min(requested_hard, current_hard)
        soft = min(soft, requested_hard)
    resource.setrlimit(name, (soft, requested_hard))


def apply_limits(limits: ResourceLimits) -> None:
    """Apply hard child limits before loading an untrusted media parser."""
    _set_limit(getattr(resource, "RLIMIT_CPU", None), limits.cpu_seconds, limits.cpu_seconds + 1)
    _set_limit(getattr(resource, "RLIMIT_AS", None), limits.memory_bytes)
    _set_limit(getattr(resource, "RLIMIT_FSIZE", None), limits.file_size_bytes)
    _set_limit(getattr(resource, "RLIMIT_NPROC", None), limits.process_count)
    _set_limit(getattr(resource, "RLIMIT_NOFILE", None), limits.open_files)
    _set_limit(getattr(resource, "RLIMIT_CORE", None), 0)
    os.umask(0o077)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) < 3 or arguments[1] != "--":
        print("sandbox usage: LIMITS_JSON -- COMMAND...", file=sys.stderr)
        return 125
    try:
        payload = json.loads(arguments[0])
        limits = ResourceLimits(**payload)
        apply_limits(limits)
        os.execvpe(arguments[2], arguments[2:], os.environ)
    except Exception as exc:  # noqa: BLE001 - report only the primitive type
        print(f"sandbox setup failed: {type(exc).__name__}", file=sys.stderr)
        return 126
    return 127


if __name__ == "__main__":
    raise SystemExit(main())
