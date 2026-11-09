"""Validate and replay a captured OpenContext result without source media."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from oc_worker.agent import build_implementation_brief

_CERTAINTIES = {"OBSERVED", "INFERRED", "UNCERTAIN"}
_KINDS = {"TRANSCRIPT", "VISUAL", "OCR"}
_EVIDENCE_COLLECTIONS = {
    "transcript",
    "visualFindings",
    "uiHierarchy",
    "interactions",
    "visibleText",
    "stateTransitions",
    "implementationObservations",
}
_TIMESTAMP_TOLERANCE = 0.001


def _error(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if number == number else None


def _collection_text(collection: str, item: Any) -> str | None:
    if collection in {"visibleText", "uiHierarchy", "interactions"}:
        if isinstance(item, str):
            return item
        if collection == "visibleText" and isinstance(item, dict):
            value = item.get("text")
            return str(value) if value is not None else None
        if collection == "uiHierarchy" and isinstance(item, dict):
            value = item.get("label") or item.get("type")
            return str(value) if value is not None else None
        return None
    if not isinstance(item, dict):
        return None
    key = (
        "change"
        if collection == "stateTransitions"
        else "note"
        if collection == "implementationObservations"
        else "text"
    )
    value = item.get(key)
    return str(value) if value is not None else None


def validate_context(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic report of context invariants used during replay."""
    errors: list[dict[str, str]] = []
    source = payload.get("source")
    duration: float | None = None
    if not isinstance(source, dict):
        errors.append(_error("SOURCE_MISSING", "source", "Source metadata is required"))
    else:
        if not str(source.get("name") or "").strip():
            errors.append(
                _error("SOURCE_NAME_MISSING", "source.name", "Source name is required")
            )
        duration = _number(source.get("durationSec"))
        if duration is None or duration <= 0:
            errors.append(
                _error(
                    "SOURCE_DURATION_INVALID",
                    "source.durationSec",
                    "Source duration must be a positive number",
                )
            )

    evidence = payload.get("evidence")
    if not isinstance(evidence, list):
        errors.append(
            _error("EVIDENCE_LEDGER_INVALID", "evidence", "Evidence must be an array")
        )
        evidence = []

    seen_ids: set[int] = set()
    for position, record in enumerate(evidence):
        path = f"evidence[{position}]"
        if not isinstance(record, dict):
            errors.append(
                _error("EVIDENCE_RECORD_INVALID", path, "Evidence must be an object")
            )
            continue

        evidence_id = record.get("id")
        if (
            isinstance(evidence_id, bool)
            or not isinstance(evidence_id, int)
            or evidence_id <= 0
        ):
            errors.append(
                _error(
                    "EVIDENCE_ID_INVALID",
                    f"{path}.id",
                    "Evidence ID must be a positive integer",
                )
            )
        elif evidence_id in seen_ids:
            errors.append(
                _error(
                    "EVIDENCE_ID_DUPLICATE",
                    f"{path}.id",
                    f"Evidence ID E{evidence_id:04d} is duplicated",
                )
            )
        else:
            seen_ids.add(evidence_id)
            if evidence_id != position + 1:
                errors.append(
                    _error(
                        "EVIDENCE_ID_SEQUENCE",
                        f"{path}.id",
                        f"Expected E{position + 1:04d}, found E{evidence_id:04d}",
                    )
                )

        kind = str(record.get("kind") or "").upper()
        if kind not in _KINDS:
            errors.append(
                _error(
                    "EVIDENCE_KIND_INVALID",
                    f"{path}.kind",
                    f"Unknown evidence kind: {kind or '(missing)'}",
                )
            )
        certainty = str(record.get("certainty") or "").upper()
        if certainty not in _CERTAINTIES:
            errors.append(
                _error(
                    "EVIDENCE_CERTAINTY_INVALID",
                    f"{path}.certainty",
                    f"Unknown certainty: {certainty or '(missing)'}",
                )
            )

        timestamp = _number(record.get("timestampSec"))
        if timestamp is None or timestamp < 0:
            errors.append(
                _error(
                    "EVIDENCE_TIMESTAMP_INVALID",
                    f"{path}.timestampSec",
                    "Evidence timestamp must be non-negative",
                )
            )
        elif (
            duration is not None
            and timestamp > duration + _TIMESTAMP_TOLERANCE
        ):
            errors.append(
                _error(
                    "EVIDENCE_TIMESTAMP_OUT_OF_RANGE",
                    f"{path}.timestampSec",
                    "Evidence timestamp exceeds source duration",
                )
            )
        if "endSec" in record:
            end_sec = _number(record.get("endSec"))
            if end_sec is None or (
                timestamp is not None and end_sec < timestamp
            ):
                errors.append(
                    _error(
                        "EVIDENCE_END_INVALID",
                        f"{path}.endSec",
                        "Evidence end must be greater than or equal to its timestamp",
                    )
                )
            elif (
                duration is not None
                and end_sec > duration + _TIMESTAMP_TOLERANCE
            ):
                errors.append(
                    _error(
                        "EVIDENCE_END_OUT_OF_RANGE",
                        f"{path}.endSec",
                        "Evidence end exceeds source duration",
                    )
                )

        evidence_source = record.get("source")
        if not isinstance(evidence_source, dict):
            errors.append(
                _error(
                    "EVIDENCE_SOURCE_INVALID",
                    f"{path}.source",
                    "Evidence source must be an object",
                )
            )
            continue
        collection = str(evidence_source.get("collection") or "")
        index = evidence_source.get("index")
        if collection not in _EVIDENCE_COLLECTIONS:
            errors.append(
                _error(
                    "EVIDENCE_COLLECTION_INVALID",
                    f"{path}.source.collection",
                    f"Unknown source collection: {collection or '(missing)'}",
                )
            )
            continue
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or index < 0
        ):
            errors.append(
                _error(
                    "EVIDENCE_SOURCE_INDEX_INVALID",
                    f"{path}.source.index",
                    "Evidence source index must be a non-negative integer",
                )
            )
            continue
        items = payload.get(collection)
        if not isinstance(items, list):
            errors.append(
                _error(
                    "EVIDENCE_COLLECTION_MISSING",
                    collection,
                    "Referenced source collection must be an array",
                )
            )
            continue
        if index >= len(items):
            errors.append(
                _error(
                    "EVIDENCE_SOURCE_INDEX_OUT_OF_RANGE",
                    f"{path}.source.index",
                    f"Index {index} is outside {collection}",
                )
            )
            continue
        expected_text = _collection_text(collection, items[index])
        actual_text = str(record.get("text") or "")
        if expected_text != actual_text:
            errors.append(
                _error(
                    "EVIDENCE_TEXT_MISMATCH",
                    f"{path}.text",
                    f"Evidence text does not match {collection}[{index}]",
                )
            )

    timeline = payload.get("timeline")
    timeline_count = 0
    if not isinstance(timeline, list):
        errors.append(_error("TIMELINE_INVALID", "timeline", "Timeline must be an array"))
    else:
        timeline_count = len(timeline)
        previous_start = -1.0
        previous_end: float | None = None
        for index, entry in enumerate(timeline):
            path = f"timeline[{index}]"
            if not isinstance(entry, dict):
                errors.append(
                    _error("TIMELINE_ENTRY_INVALID", path, "Timeline entry must be an object")
                )
                continue
            start = _number(entry.get("start"))
            end = _number(entry.get("end"))
            if start is None or start < 0:
                errors.append(
                    _error(
                        "TIMELINE_START_INVALID",
                        f"{path}.start",
                        "Timeline start must be non-negative",
                    )
                )
                continue
            if start < previous_start:
                errors.append(
                    _error(
                        "TIMELINE_ORDER_INVALID",
                        f"{path}.start",
                        "Timeline entries must be chronological",
                    )
                )
            if (
                previous_end is not None
                and abs(start - previous_end) > _TIMESTAMP_TOLERANCE
            ):
                errors.append(
                    _error(
                        "TIMELINE_CONTINUITY_INVALID",
                        f"{path}.start",
                        "Timeline entries must be continuous",
                    )
                )
            previous_start = start
            if end is None or end < start:
                errors.append(
                    _error(
                        "TIMELINE_END_INVALID",
                        f"{path}.end",
                        "Timeline end must be greater than or equal to start",
                    )
                )
            elif duration is not None and end > duration + _TIMESTAMP_TOLERANCE:
                errors.append(
                    _error(
                        "TIMELINE_END_OUT_OF_RANGE",
                        f"{path}.end",
                        "Timeline end exceeds source duration",
                    )
                )
            previous_end = end if end is not None else None

    transcript = payload.get("transcript")
    transcript_count = 0
    if not isinstance(transcript, list):
        errors.append(
            _error("TRANSCRIPT_INVALID", "transcript", "Transcript must be an array")
        )
    else:
        transcript_count = len(transcript)
        for index, segment in enumerate(transcript):
            path = f"transcript[{index}]"
            if not isinstance(segment, dict):
                errors.append(
                    _error(
                        "TRANSCRIPT_SEGMENT_INVALID",
                        path,
                        "Transcript segment must be an object",
                    )
                )
                continue
            start = _number(segment.get("start"))
            end = _number(segment.get("end"))
            if start is None or start < 0:
                errors.append(
                    _error(
                        "TRANSCRIPT_START_INVALID",
                        f"{path}.start",
                        "Transcript start must be non-negative",
                    )
                )
            if end is None or (start is not None and end < start):
                errors.append(
                    _error(
                        "TRANSCRIPT_END_INVALID",
                        f"{path}.end",
                        "Transcript end must be greater than or equal to start",
                    )
                )
            elif duration is not None and end > duration + _TIMESTAMP_TOLERANCE:
                errors.append(
                    _error(
                        "TRANSCRIPT_END_OUT_OF_RANGE",
                        f"{path}.end",
                        "Transcript end exceeds source duration",
                    )
                )
            if not str(segment.get("text") or "").strip():
                errors.append(
                    _error(
                        "TRANSCRIPT_TEXT_MISSING",
                        f"{path}.text",
                        "Transcript text must not be empty",
                    )
                )

    return {
        "replayVersion": 1,
        "ok": not errors,
        "source": source.get("name") if isinstance(source, dict) else None,
        "counts": {
            "evidence": len(evidence),
            "timeline": timeline_count,
            "transcript": transcript_count,
        },
        "errors": errors,
    }


def replay_context(
    payload: dict[str, Any],
    *,
    repository: str | None = None,
    task: str | None = None,
) -> tuple[dict[str, Any], str | None]:
    """Validate a captured context and render its brief when all checks pass."""
    report = validate_context(payload)
    if not report["ok"]:
        return report, None
    rendered = build_implementation_brief(
        payload,
        repository=repository,
        task=task,
    )
    canonical_context = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    report["contextSha256"] = hashlib.sha256(canonical_context).hexdigest()
    report["briefSha256"] = hashlib.sha256(rendered.encode("utf-8")).hexdigest()
    return report, rendered
