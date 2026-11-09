"""Evidence-preserving implementation briefs for coding agents."""

from __future__ import annotations

import json
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from oc_worker.context import format_timestamp

_SKIP_DIRECTORIES = {
    ".git",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".tmp",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "vendor",
}
_LANGUAGE_EXTENSIONS = {
    ".css": "CSS",
    ".go": "Go",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".kt": "Kotlin",
    ".md": "Markdown",
    ".py": "Python",
    ".rb": "Ruby",
    ".rs": "Rust",
    ".sh": "Shell",
    ".sql": "SQL",
    ".swift": "Swift",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
}
_MAX_SCAN_FILES = 1_000
_MAX_TEXT_FILE_BYTES = 1_000_000


@dataclass(frozen=True)
class RepositoryProfile:
    name: str
    languages: tuple[str, ...]
    technologies: tuple[str, ...]
    manifests: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "languages": list(self.languages),
            "technologies": list(self.technologies),
            "manifests": list(self.manifests),
        }


def _read_small_json(path: Path) -> dict[str, Any]:
    try:
        if path.stat().st_size > _MAX_TEXT_FILE_BYTES:
            return {}
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def detect_repository_profile(repository: str | Path | None) -> RepositoryProfile | None:
    """Inspect a repository's structure without executing or uploading it."""
    if repository is None:
        return None
    root = Path(repository).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Repository path is not a directory: {root}")

    language_counts: Counter[str] = Counter()
    manifests: set[str] = set()
    technologies: set[str] = set()
    scanned = 0
    for current, directories, files in os.walk(root):
        directories[:] = sorted(
            directory for directory in directories if directory not in _SKIP_DIRECTORIES
        )
        current_path = Path(current)
        for filename in sorted(files):
            if scanned >= _MAX_SCAN_FILES:
                break
            scanned += 1
            path = current_path / filename
            language = _LANGUAGE_EXTENSIONS.get(path.suffix.lower())
            if language:
                language_counts[language] += 1
            if filename in {
                "Cargo.toml",
                "Dockerfile",
                "build.gradle",
                "docker-compose.yml",
                "go.mod",
                "package.json",
                "pom.xml",
                "pyproject.toml",
                "requirements.txt",
                "schema.prisma",
            }:
                manifests.add(path.relative_to(root).as_posix())
        if scanned >= _MAX_SCAN_FILES:
            break

    package_manifests = [
        manifest for manifest in manifests if manifest.endswith("package.json")
    ]
    if package_manifests:
        technologies.add("Node.js")
        language_counts["JavaScript"] += 1
    for manifest in package_manifests[:20]:
        package = _read_small_json(root / manifest)
        dependencies = {
            **(package.get("dependencies") or {}),
            **(package.get("devDependencies") or {}),
        }
        if "next" in dependencies:
            technologies.add("Next.js")
        if "react" in dependencies:
            technologies.add("React")
        if "prisma" in dependencies or "@prisma/client" in dependencies:
            technologies.add("Prisma")
        if "vitest" in dependencies:
            technologies.add("Vitest")
        if "typescript" in dependencies:
            technologies.add("TypeScript")

    if (root / "pyproject.toml").is_file() or (root / "requirements.txt").is_file():
        language_counts["Python"] += 1
        technologies.add("Python")
    if (root / "schema.prisma").is_file() or any(
        manifest.endswith("schema.prisma") for manifest in manifests
    ):
        technologies.add("Prisma")
    if (root / "Dockerfile").is_file() or (root / "docker-compose.yml").is_file():
        technologies.add("Docker")
    if (root / ".github" / "workflows").is_dir():
        technologies.add("GitHub Actions")

    return RepositoryProfile(
        name=root.name,
        languages=tuple(
            language for language, _count in language_counts.most_common(8)
        ),
        technologies=tuple(sorted(technologies)),
        manifests=tuple(sorted(manifests)[:30]),
    )


def load_context_payload(path: str | Path) -> dict[str, Any]:
    context_path = Path(path).expanduser().resolve()
    try:
        payload = json.loads(context_path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"Could not read context JSON: {context_path}") from exc
    except ValueError as exc:
        raise ValueError(f"Context file is not valid JSON: {context_path}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Context JSON must be an object")
    if not isinstance(payload.get("source"), dict):
        raise ValueError("Context JSON is missing source metadata")
    if not isinstance(payload.get("evidence"), list):
        raise ValueError("Context JSON is missing an evidence ledger")
    return payload


def _marker(record: dict[str, Any]) -> str:
    evidence_id = int(record.get("id") or 0)
    timestamp = format_timestamp(float(record.get("timestampSec") or 0))
    certainty = str(record.get("certainty") or "OBSERVED").title()
    return f"[E{evidence_id:04d} · {timestamp} · {certainty}]"


def _bullet_records(
    evidence: list[dict[str, Any]],
    *,
    collections: set[str],
    limit: int = 40,
) -> list[str]:
    rows: list[str] = []
    seen: set[str] = set()
    for record in evidence:
        source = record.get("source")
        if not isinstance(source, dict) or source.get("collection") not in collections:
            continue
        text = str(record.get("text") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        rows.append(f"- {text} {_marker(record)}")
        if len(rows) >= limit:
            break
    return rows


def build_implementation_brief(
    payload: dict[str, Any],
    *,
    repository: str | Path | None = None,
    task: str | None = None,
) -> str:
    """Render a repository-aware prompt from an evidence-linked context payload."""
    source = payload.get("source") or {}
    evidence = [item for item in payload.get("evidence") or [] if isinstance(item, dict)]
    source_name = str(source.get("name") or "recorded workflow")
    requested_task = (
        task.strip()
        if task and task.strip()
        else "Implement the recorded workflow in this repository."
    )
    profile = detect_repository_profile(repository)

    lines = [
        f"# Implementation Brief: {source_name}",
        "",
        "> Generated deterministically from OpenContext evidence. Preserve the",
        "> evidence markers when carrying claims into code or tests.",
        "",
        "## Task",
        "",
        requested_task,
        "",
        "## Repository fit",
        "",
    ]
    if profile:
        lines.extend(
            [
                f"- Repository: `{profile.name}`",
                f"- Languages: {', '.join(profile.languages) or 'not detected'}",
                f"- Technologies: {', '.join(profile.technologies) or 'not detected'}",
                "- Manifests: "
                + (
                    ", ".join(f"`{item}`" for item in profile.manifests)
                    or "none detected"
                ),
            ]
        )
    else:
        lines.append("- Repository profile not supplied; inspect the target codebase first.")

    lines.extend(["", "## Observed workflow", ""])
    timeline = [item for item in payload.get("timeline") or [] if isinstance(item, dict)]
    if timeline:
        for item in timeline[:30]:
            start = format_timestamp(float(item.get("start") or 0))
            end = format_timestamp(float(item.get("end") or item.get("start") or 0))
            title = str(item.get("title") or "Scene")
            summary = str(item.get("summary") or "").strip()
            lines.append(
                f"- `[{start}-{end}]` **{title}**"
                + (f" — {summary}" if summary else "")
            )
    else:
        lines.append("- No visual timeline was recorded.")

    lines.extend(["", "## Implementation targets", ""])
    targets = _bullet_records(
        evidence,
        collections={"uiHierarchy", "interactions", "stateTransitions"},
    )
    lines.extend(targets or ["- No implementation targets were extracted."])

    lines.extend(["", "## Acceptance criteria", ""])
    criteria = _bullet_records(
        evidence,
        collections={"interactions", "stateTransitions", "visibleText"},
    )
    if criteria:
        lines.extend(f"- [ ] {row[2:]}" for row in criteria)
    else:
        lines.append("- [ ] Implement only behavior directly supported by the evidence.")

    lines.extend(["", "## Transcript context", ""])
    transcript = _bullet_records(evidence, collections={"transcript"}, limit=30)
    lines.extend(transcript or ["- No transcript evidence was extracted."])

    lines.extend(["", "## Uncertainty and review", ""])
    uncertain = [
        record
        for record in evidence
        if str(record.get("certainty") or "").upper() != "OBSERVED"
    ]
    if uncertain:
        for record in uncertain[:30]:
            lines.append(f"- Verify: {record.get('text')} {_marker(record)}")
    else:
        lines.append("- No inferred or uncertain evidence was recorded.")

    lines.extend(
        [
            "",
            "## Agent instructions",
            "",
            "1. Inspect the repository and identify the files implementing the observed flow.",
            "2. Map each acceptance criterion to an implementation and a test.",
            "3. Treat inferred or uncertain evidence as a hypothesis to verify.",
            "4. Do not invent behavior that has no evidence marker.",
            "5. Preserve timestamped evidence IDs in the final handoff.",
            "",
        ]
    )
    return "\n".join(lines)
