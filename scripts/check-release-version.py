"""Fail a release when the Git tag and package identities differ."""

from __future__ import annotations

import json
import os
import sys
import tomllib
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ref_type = os.getenv("GITHUB_REF_TYPE", "")
    if ref_type and ref_type != "tag":
        print(
            f"Release publishing requires a tag ref, got {ref_type!r}",
            file=sys.stderr,
        )
        return 1
    tag = os.getenv("GITHUB_REF_NAME", "")
    if not tag.startswith("v"):
        print(f"Expected a v-prefixed release tag, got {tag!r}", file=sys.stderr)
        return 1
    expected = tag[1:]
    with (root / "workers" / "processor" / "pyproject.toml").open("rb") as handle:
        python_version = tomllib.load(handle)["project"]["version"]
    npm_package = json.loads(
        (root / "packages" / "schemas" / "package.json").read_text(encoding="utf-8")
    )
    npm_version = npm_package["version"]
    values = {
        "tag": expected,
        "python": python_version,
        "npm": npm_version,
    }
    if len(set(values.values())) != 1:
        print(f"Version mismatch: {values}", file=sys.stderr)
        return 1
    expected_npm_name = "@kylosonic/opencontext-schemas"
    if npm_package.get("name") != expected_npm_name:
        print(
            f"Expected npm package {expected_npm_name!r}, "
            f"got {npm_package.get('name')!r}",
            file=sys.stderr,
        )
        return 1
    print(f"Release version verified: {expected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
