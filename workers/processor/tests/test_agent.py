"""Repository-aware implementation brief tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from oc_worker.agent import (
    build_implementation_brief,
    detect_repository_profile,
    load_context_payload,
)


def _payload() -> dict:
    return {
        "source": {"name": "checkout.mp4", "durationSec": 12},
        "timeline": [
            {
                "start": 0,
                "end": 12,
                "title": "Checkout",
                "summary": "A form submits and a success state appears.",
            }
        ],
        "evidence": [
            {
                "id": 1,
                "kind": "TRANSCRIPT",
                "timestampSec": 1,
                "certainty": "OBSERVED",
                "text": "Choose the saved card.",
                "source": {"collection": "transcript", "index": 0},
            },
            {
                "id": 2,
                "kind": "VISUAL",
                "timestampSec": 4,
                "certainty": "OBSERVED",
                "text": "Pay now button",
                "source": {"collection": "uiHierarchy", "index": 0},
            },
            {
                "id": 3,
                "kind": "VISUAL",
                "timestampSec": 5,
                "certainty": "INFERRED",
                "text": "The user clicks Pay now",
                "source": {"collection": "interactions", "index": 0},
            },
            {
                "id": 4,
                "kind": "VISUAL",
                "timestampSec": 7,
                "certainty": "OBSERVED",
                "text": "Payment successful",
                "source": {"collection": "stateTransitions", "index": 0},
            },
        ],
    }


def test_detects_repository_technologies_without_scanning_dependencies(
    tmp_path: Path,
) -> None:
    (tmp_path / "package.json").write_text(
        json.dumps(
            {
                "dependencies": {"next": "1", "react": "1"},
                "devDependencies": {"typescript": "1", "vitest": "1"},
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "schema.prisma").write_text("datasource db {}", encoding="utf-8")
    (tmp_path / "app.tsx").write_text("export {};", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "ignored.py").write_text("", encoding="utf-8")
    workflows = tmp_path / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text("name: CI", encoding="utf-8")

    profile = detect_repository_profile(tmp_path)

    assert profile is not None
    assert profile.languages[0] == "TypeScript"
    assert "Python" not in profile.languages
    assert set(profile.technologies) >= {
        "GitHub Actions",
        "Next.js",
        "Node.js",
        "Prisma",
        "React",
        "TypeScript",
        "Vitest",
    }


def test_brief_is_evidence_linked_and_repository_aware(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname='demo'", encoding="utf-8")
    (tmp_path / "app.py").write_text("print('demo')", encoding="utf-8")

    brief = build_implementation_brief(
        _payload(),
        repository=tmp_path,
        task="Implement checkout completion.",
    )

    assert brief.startswith("# Implementation Brief: checkout.mp4")
    assert "Implement checkout completion." in brief
    assert "Languages: Python" in brief
    assert "[E0001 · 00:01 · Observed]" in brief
    assert "[E0003 · 00:05 · Inferred]" in brief
    assert "- [ ] The user clicks Pay now" in brief
    assert "Verify: The user clicks Pay now" in brief
    assert "Do not invent behavior" in brief


def test_context_loader_rejects_incomplete_results(tmp_path: Path) -> None:
    path = tmp_path / "context.json"
    path.write_text('{"source": {}}', encoding="utf-8")

    with pytest.raises(ValueError, match="evidence ledger"):
        load_context_payload(path)
