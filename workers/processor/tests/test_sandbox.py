from pathlib import Path

import pytest

from oc_worker.sandbox import WorkspaceSandbox


def test_resolves_files_inside_explicit_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    media = workspace / "screen.png"
    media.write_bytes(b"png")

    sandbox = WorkspaceSandbox([workspace])

    assert sandbox.media_file("screen.png") == media.resolve()
    assert sandbox.repository(".") == workspace.resolve()


def test_rejects_parent_and_symlink_escapes(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"png")
    (workspace / "escape.png").symlink_to(outside)
    sandbox = WorkspaceSandbox([workspace])

    with pytest.raises(ValueError, match="outside"):
        sandbox.media_file("../outside.png")
    with pytest.raises(ValueError, match="outside"):
        sandbox.media_file("escape.png")


def test_rejects_unsupported_and_special_files(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "notes.txt").write_text("not media", encoding="utf-8")
    sandbox = WorkspaceSandbox([workspace])

    with pytest.raises(ValueError, match="extension"):
        sandbox.media_file("notes.txt")
    with pytest.raises(ValueError, match="regular file"):
        sandbox.context_file(".")
