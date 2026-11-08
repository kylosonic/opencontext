"""Fail a release when the Git tag and package versions differ."""

from __future__ import annotations

import json
import os
import sys
import tomllib
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    tag = os.getenv("GITHUB_REF_NAME", "")
    if not tag.startswith("v"):
        print(f"Expected a v-prefixed release tag, got {tag!r}", file=sys.stderr)
        return 1
    expected = tag[1:]
    with (root / "workers" / "processor" / "pyproject.toml").open("rb") as handle:
        python_version = tomllib.load(handle)["project"]["version"]
    npm_version = json.loads(
        (root / "packages" / "schemas" / "package.json").read_text(encoding="utf-8")
    )["version"]
    values = {
        "tag": expected,
        "python": python_version,
        "npm": npm_version,
    }
    if len(set(values.values())) != 1:
        print(f"Version mismatch: {values}", file=sys.stderr)
        return 1
    print(f"Release version verified: {expected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
