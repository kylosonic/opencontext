"""Filesystem allow-list helpers for MCP tools and repository inspection."""

from __future__ import annotations

import os
import stat
from pathlib import Path

MEDIA_EXTENSIONS = {
    ".avi",
    ".jpeg",
    ".jpg",
    ".mkv",
    ".mov",
    ".mp4",
    ".pdf",
    ".png",
    ".webm",
    ".webp",
}


class WorkspaceSandbox:
    """Resolve user-supplied paths only beneath explicitly allowed roots."""

    def __init__(self, roots: list[str | Path]) -> None:
        resolved: list[Path] = []
        for value in roots:
            root = Path(value).expanduser().resolve()
            if not root.is_dir():
                raise ValueError(f"Workspace root is not a directory: {root}")
            resolved.append(root)
        if not resolved:
            raise ValueError(
                "At least one workspace root is required; pass --workspace or "
                "OPENCONTEXT_WORKSPACE_ROOTS"
            )
        self.roots = tuple(dict.fromkeys(resolved))

    @property
    def default_root(self) -> Path:
        return self.roots[0]

    def resolve(self, value: str | Path, *, kind: str) -> Path:
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = self.default_root / candidate
        # Normalize and resolve existing symlinks without requiring the final
        # path to exist. Authorize the normalized path before touching the
        # filesystem so existing and nonexistent outside paths return the
        # same error (no host-file existence oracle).
        resolved = candidate.resolve(strict=False)
        if not any(_is_relative_to(resolved, root) for root in self.roots):
            raise ValueError("Path is outside the configured workspace roots")
        try:
            info = resolved.stat()
        except OSError as exc:
            raise ValueError(f"Path does not exist: {candidate}") from exc
        if kind == "file" and not stat.S_ISREG(info.st_mode):
            raise ValueError(f"Path is not a regular file: {resolved}")
        if kind == "directory" and not stat.S_ISDIR(info.st_mode):
            raise ValueError(f"Path is not a directory: {resolved}")
        return resolved

    def media_file(self, value: str | Path) -> Path:
        path = self.resolve(value, kind="file")
        if path.suffix.lower() not in MEDIA_EXTENSIONS:
            raise ValueError(f"Unsupported media extension: {path.suffix or '(none)'}")
        return path

    def context_file(self, value: str | Path) -> Path:
        path = self.resolve(value, kind="file")
        if path.suffix.lower() != ".json":
            raise ValueError("Context input must be a .json file")
        return path

    def repository(self, value: str | Path) -> Path:
        return self.resolve(value, kind="directory")


def roots_from_env() -> list[str]:
    raw = os.getenv("OPENCONTEXT_WORKSPACE_ROOTS", "")
    return [item for item in raw.split(os.pathsep) if item.strip()]


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False
