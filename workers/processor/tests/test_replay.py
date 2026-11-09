"""Captured-context replay validation and CLI tests."""

from __future__ import annotations

import json
from pathlib import Path

from oc_worker.cli import main
from oc_worker.replay import replay_context, validate_context


def _payload() -> dict:
    return {
        "formatVersion": 2,
        "evidenceVersion": 1,
        "source": {
            "name": "settings-flow.mp4",
            "durationSec": 12,
            "detailLevel": "MEDIUM",
        },
        "timeline": [
            {
                "start": 0,
                "end": 6,
                "title": "Settings",
                "summary": "The settings form is visible.",
            },
            {
                "start": 6,
                "end": 12,
                "title": "Saved",
                "summary": "A success state appears.",
            },
        ],
        "transcript": [
            {"start": 1, "end": 2, "text": "Change the display name."}
        ],
        "visualFindings": [
            {
                "field": "visualDescription",
                "timestampSec": 2,
                "certainty": "OBSERVED",
                "text": "A settings form with a text field.",
            }
        ],
        "uiHierarchy": ["Save Changes"],
        "interactions": ["The user clicks Save Changes"],
        "visibleText": ["Settings"],
        "stateTransitions": [
            {"timestampSec": 6, "change": "Settings saved successfully"}
        ],
        "implementationObservations": [
            {"timestampSec": 6, "note": "feedback: green success banner"}
        ],
        "evidence": [
            {
                "id": 1,
                "kind": "TRANSCRIPT",
                "timestampSec": 1,
                "endSec": 2,
                "certainty": "OBSERVED",
                "text": "Change the display name.",
                "source": {"collection": "transcript", "index": 0},
            },
            {
                "id": 2,
                "kind": "VISUAL",
                "timestampSec": 2,
                "certainty": "OBSERVED",
                "text": "A settings form with a text field.",
                "source": {"collection": "visualFindings", "index": 0},
            },
            {
                "id": 3,
                "kind": "VISUAL",
                "timestampSec": 3,
                "certainty": "OBSERVED",
                "text": "Save Changes",
                "source": {"collection": "uiHierarchy", "index": 0},
            },
            {
                "id": 4,
                "kind": "VISUAL",
                "timestampSec": 4,
                "certainty": "INFERRED",
                "text": "The user clicks Save Changes",
                "source": {"collection": "interactions", "index": 0},
            },
            {
                "id": 5,
                "kind": "VISUAL",
                "timestampSec": 2,
                "certainty": "OBSERVED",
                "text": "Settings",
                "source": {"collection": "visibleText", "index": 0},
            },
            {
                "id": 6,
                "kind": "VISUAL",
                "timestampSec": 6,
                "certainty": "OBSERVED",
                "text": "Settings saved successfully",
                "source": {"collection": "stateTransitions", "index": 0},
            },
            {
                "id": 7,
                "kind": "VISUAL",
                "timestampSec": 6,
                "certainty": "OBSERVED",
                "text": "feedback: green success banner",
                "source": {"collection": "implementationObservations", "index": 0},
            },
        ],
    }


def test_valid_context_replays_as_evidence_linked_brief(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname='demo'", encoding="utf-8")
    (tmp_path / "app.py").write_text("print('demo')", encoding="utf-8")

    report, brief = replay_context(
        _payload(),
        repository=str(tmp_path),
        task="Implement the saved settings flow.",
    )

    assert report["ok"] is True
    assert report["counts"] == {"evidence": 7, "timeline": 2, "transcript": 1}
    assert report["errors"] == []
    assert len(report["contextSha256"]) == 64
    assert len(report["briefSha256"]) == 64
    assert report["contextSha256"] == replay_context(_payload())[0]["contextSha256"]
    assert brief is not None
    assert "Implement the saved settings flow." in brief
    assert "Languages: Python" in brief
    assert "[E0006 · 00:06 · Observed]" in brief
    assert "[E0004 · 00:04 · Inferred]" in brief


def test_replay_rejects_dangling_and_inconsistent_evidence() -> None:
    payload = _payload()
    payload["visibleText"][0] = "Changed after capture"
    payload["evidence"][1]["timestampSec"] = 99
    payload["timeline"][1]["end"] = 15

    report = validate_context(payload)

    assert report["ok"] is False
    codes = {error["code"] for error in report["errors"]}
    assert "EVIDENCE_TEXT_MISMATCH" in codes
    assert "EVIDENCE_TIMESTAMP_OUT_OF_RANGE" in codes
    assert "TIMELINE_END_OUT_OF_RANGE" in codes


def test_replay_rejects_broken_ranges_and_empty_transcript() -> None:
    payload = _payload()
    payload["evidence"][0]["endSec"] = 13
    payload["transcript"][0]["text"] = ""
    payload["timeline"][1]["start"] = 7
    payload["timeline"][1]["end"] = 12

    report = validate_context(payload)

    codes = {error["code"] for error in report["errors"]}
    assert "EVIDENCE_END_OUT_OF_RANGE" in codes
    assert "TRANSCRIPT_TEXT_MISSING" in codes
    assert "TIMELINE_CONTINUITY_INVALID" in codes


def test_replay_cli_writes_brief_and_machine_report(
    tmp_path: Path, capsys
) -> None:
    context_path = tmp_path / "context.json"
    context_path.write_text(json.dumps(_payload()), encoding="utf-8")
    brief_path = tmp_path / "brief.md"
    report_path = tmp_path / "replay.json"

    code = main(
        [
            "replay",
            str(context_path),
            "--task",
            "Implement the recorded flow.",
            "--out",
            str(brief_path),
            "--report",
            str(report_path),
        ]
    )

    assert code == 0
    assert "Implementation Brief" in brief_path.read_text(encoding="utf-8")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["ok"] is True
    assert capsys.readouterr().err == ""


def test_replay_cli_reports_invalid_capture(tmp_path: Path, capsys) -> None:
    payload = _payload()
    payload["evidence"][2]["source"]["index"] = 4
    context_path = tmp_path / "invalid-context.json"
    context_path.write_text(json.dumps(payload), encoding="utf-8")
    report_path = tmp_path / "invalid-replay.json"

    code = main(
        [
            "replay",
            str(context_path),
            "--report",
            str(report_path),
        ]
    )

    assert code == 1
    assert "EVIDENCE_SOURCE_INDEX_OUT_OF_RANGE" in capsys.readouterr().err
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["ok"] is False
