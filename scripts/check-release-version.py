"""Fail a release when the Git tag and package identities differ."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tomllib
from pathlib import Path


def _json_version(path: Path) -> str:
    package = json.loads(path.read_text(encoding="utf-8"))
    version = package.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError(f"{path} has no string version")
    return version


def _action_default_version(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if "\ninputs:\n" not in text or "\nruns:\n" not in text:
        raise ValueError(f"{path} is missing inputs or runs")
    inputs = text.split("\ninputs:\n", 1)[1].split("\nruns:\n", 1)[0]
    match = re.search(
        r"(?ms)^  version:\n(?P<body>(?:    .*\n)+)",
        inputs,
    )
    if not match:
        raise ValueError(f"{path} has no version input")
    default = re.search(
        r'^    default: "([^"]+)"$',
        match.group("body"),
        re.MULTILINE,
    )
    if not default:
        raise ValueError(f"{path} version input has no quoted default")
    return default.group(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tag",
        help="Release tag to verify (defaults to GITHUB_REF_NAME)",
    )
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    ref_type = os.getenv("GITHUB_REF_TYPE", "")
    if ref_type and ref_type != "tag":
        print(
            f"Release publishing requires a tag ref, got {ref_type!r}",
            file=sys.stderr,
        )
        return 1
    tag = args.tag or os.getenv("GITHUB_REF_NAME", "")
    if not tag.startswith("v"):
        print(f"Expected a v-prefixed release tag, got {tag!r}", file=sys.stderr)
        return 1
    expected = tag[1:]
    with (root / "workers" / "processor" / "pyproject.toml").open("rb") as handle:
        python_version = tomllib.load(handle)["project"]["version"]
    npm_paths = {
        "root": root / "package.json",
        "web": root / "apps" / "web" / "package.json",
        "config": root / "packages" / "config" / "package.json",
        "schemas": root / "packages" / "schemas" / "package.json",
    }
    npm_versions = {name: _json_version(path) for name, path in npm_paths.items()}
    lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
    lock_packages = lock.get("packages", {})
    lock_versions = {
        "root": lock_packages.get("", {}).get("version"),
        "web": lock_packages.get("apps/web", {}).get("version"),
        "config": lock_packages.get("packages/config", {}).get("version"),
        "schemas": lock_packages.get("packages/schemas", {}).get("version"),
    }
    action_version = _action_default_version(root / "action.yml")
    values = {
        "tag": expected,
        "python": python_version,
        **{f"npm-{name}": version for name, version in npm_versions.items()},
        **{f"lock-{name}": version for name, version in lock_versions.items()},
        "action": action_version,
    }
    if len(set(values.values())) != 1:
        print(f"Version mismatch: {values}", file=sys.stderr)
        return 1
    expected_npm_name = "@kylosonic/opencontext-schemas"
    npm_package = json.loads(npm_paths["schemas"].read_text(encoding="utf-8"))
    if npm_package.get("name") != expected_npm_name:
        print(
            f"Expected npm package {expected_npm_name!r}, "
            f"got {npm_package.get('name')!r}",
            file=sys.stderr,
        )
        return 1
    print("Release version verified across tag, package manifests, lockfile, and action:")
    for name, version in values.items():
        print(f"  {name}: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
