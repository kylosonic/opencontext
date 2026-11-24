"""Deterministic Markdown rendering helpers for developer context payloads."""

from __future__ import annotations

import json
from typing import Any


def format_timestamp(seconds: float) -> str:
    """mm:ss of a non-negative timestamp (cap negative inputs at 0)."""
    total = int(max(0.0, float(seconds)))
    minutes, secs = divmod(total, 60)
    return f"{minutes:02d}:{secs:02d}"


def _render_value(value: Any) -> str:
    """Deterministic text for a payload value (strings verbatim)."""
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _citation(
    evidence_by_source: dict[tuple[str, int], dict[str, Any]],
    collection: str,
    index: int,
    text: str,
) -> str:
    """Find the evidence marker for one collection item, if it still matches."""
    item = evidence_by_source.get((collection, index))
    if not item or item.get("text") != text:
        return ""
    label = str(item.get("certainty") or "OBSERVED").title()
    timestamp = format_timestamp(item.get("timestampSec") or 0)
    return f" [E{item['id']:04d} · {timestamp} · {label}]"


def template_markdown(payload: dict[str, Any]) -> str:
    """Deterministic baseline markdown rendering of a JSON payload."""
    source = payload["source"]
    name = source.get("name") or "Untitled recording"
    evidence_by_source = {
        (
            (item.get("source") or {}).get("collection"),
            (item.get("source") or {}).get("index"),
        ): item
        for item in payload.get("evidence") or []
    }
    lines: list[str] = [
        f"# Developer Context: {name}",
        "",
        f"- **Source:** {name}",
        (
            "- **Source type:** Still image"
            if source.get("kind") == "image"
            else "- **Source type:** PDF"
            if source.get("kind") == "pdf"
            else "- **Source type:** Audio"
            if source.get("kind") == "audio"
            else f"- **Duration:** {format_timestamp(source.get('durationSec') or 0)}"
        ),
        f"- **Generated:** {payload.get('generatedAt')}",
        f"- **Detail level:** {source.get('detailLevel')}",
        "",
        "## Timeline",
        "",
    ]
    timeline = payload.get("timeline") or []
    if not timeline:
        lines.append("_No timeline entries._")
    for entry in timeline:
        start = format_timestamp(entry.get("start") or 0)
        end = format_timestamp(entry.get("end") or entry.get("start") or 0)
        title = (entry.get("title") or "").strip() or "Scene"
        summary = (entry.get("summary") or "").strip()
        line = f"- `[{start}-{end}]` **{title}**"
        if summary:
            line += f" — {summary}"
        lines.append(line)
    if source.get("kind") in ("image", "pdf"):
        lines.extend(
            [
                "",
                "## Source Pages"
                if source.get("kind") == "pdf"
                else "## Source Images",
                "",
            ]
        )
        source_assets = payload.get("sourceAssets") or []
        if not source_assets:
            lines.append("_No source page details were recorded._")
        for index, asset in enumerate(source_assets, start=1):
            lines.append(f"- {index}. {asset.get('name') or f'Source {index}'}")
        lines.extend(["", "## Cross-source Changes", ""])
        cross_findings = payload.get("crossImageFindings") or []
        if not cross_findings:
            lines.append(
                "_No textual or UI differences were detected between sources._"
            )
        for index, finding in enumerate(cross_findings):
            text = str(finding.get("change") or "")
            lines.append(
                f"- {text}"
                f"{_citation(evidence_by_source, 'crossImageFindings', index, text)}"
            )
    lines.extend(["", "## Visual Findings", ""])
    visual_findings = payload.get("visualFindings") or []
    if not visual_findings:
        lines.append("_No visual findings were recorded._")
    for index, finding in enumerate(visual_findings):
        label = str(finding.get("field") or "Visual finding").replace("Description", "")
        text = str(finding.get("text") or "")
        lines.append(
            f"- **{label}:** {text}"
            f"{_citation(evidence_by_source, 'visualFindings', index, text)}"
        )

    lines.extend(["", "## Transcript", ""])
    transcript = payload.get("transcript") or []
    if not transcript:
        if payload.get("audioPresent") is False:
            lines.append(
                "_Still image has no audio — transcription was skipped._"
                if source.get("kind") == "image"
                else "_PDF source has no audio — transcription was skipped._"
                if source.get("kind") == "pdf"
                else "_Audio file contained no speech._"
                if source.get("kind") == "audio"
                else "_No audio track detected — transcription was skipped._"
            )
        else:
            lines.append("_Audio track contained no speech._")
    for index, segment in enumerate(transcript):
        start = format_timestamp(segment.get("start") or 0)
        end = format_timestamp(segment.get("end") or segment.get("start") or 0)
        text = str(segment.get("text", ""))
        lines.append(
            f"- `[{start}-{end}]` {text}"
            f"{_citation(evidence_by_source, 'transcript', index, text)}"
        )
    lines.extend(["", "## UI Hierarchy", ""])
    ui_hierarchy = payload.get("uiHierarchy") or []
    if not ui_hierarchy:
        lines.append("_No UI elements observed._")
    for index, element in enumerate(ui_hierarchy):
        if isinstance(element, str):
            lines.append(
                f"- {element}{_citation(evidence_by_source, 'uiHierarchy', index, element)}"
            )
            continue
        label = element.get("label") or element.get("type") or "element"
        role = element.get("role")
        suffix = f" ({role})" if role else ""
        rendered = f"{label}{suffix}"
        lines.append(
            f"- {rendered}{_citation(evidence_by_source, 'uiHierarchy', index, rendered)}"
        )
    lines.extend(["", "## Navigation", ""])
    # Navigation verbs only exist on legacy dict interaction entries; the
    # canonical sentence strings are rendered under Interactions instead.
    navigation = [
        item
        for item in (payload.get("interactions") or [])
        if isinstance(item, dict)
        and str(item.get("action") or "").lower()
        in ("navigate", "click", "open", "route")
    ]
    if not navigation:
        lines.append("_No navigation observed._")
    for item in navigation:
        target = item.get("target") or item.get("result") or "?"
        lines.append(f"- {item.get('action', 'Navigate')} → {target}")
    lines.extend(["", "## Interactions", ""])
    interactions = payload.get("interactions") or []
    if not interactions:
        lines.append("_No interactions observed._")
    for index, item in enumerate(interactions):
        if isinstance(item, str):
            # canonical one-sentence strings render verbatim (complete
            # sentences; inference is visible through observation certainty)
            lines.append(
                f"- {item}{_citation(evidence_by_source, 'interactions', index, item)}"
            )
            continue
        rendered = (
            f"{item.get('action', 'interaction')} on "
            f"{item.get('target') or '?'} (inferred)"
        )
        lines.append(
            f"- {rendered}"
            f"{_citation(evidence_by_source, 'interactions', index, rendered)}"
        )
    lines.extend(["", "## Visible Text", ""])
    visible_text = payload.get("visibleText") or []
    if not visible_text:
        lines.append("_No visible text was detected._")
    for index, item in enumerate(visible_text):
        text = item if isinstance(item, str) else item.get("text", "")
        lines.append(
            f"- {text}{_citation(evidence_by_source, 'visibleText', index, str(text))}"
        )
    lines.extend(["", "## State Transitions", ""])
    transitions = payload.get("stateTransitions") or []
    if not transitions:
        lines.append("_No state transitions observed._")
    for index, item in enumerate(transitions):
        timestamp = format_timestamp(item.get("timestampSec") or 0)
        text = _render_value(item.get("change"))
        lines.append(
            f"- `[{timestamp}]` {text}"
            f"{_citation(evidence_by_source, 'stateTransitions', index, text)}"
        )
    lines.extend(["", "## Implementation Observations", ""])
    implementation = payload.get("implementationObservations") or []
    if not implementation:
        lines.append("_No implementation observations._")
    for index, item in enumerate(implementation):
        text = _render_value(item.get("note"))
        lines.append(
            f"- `[{format_timestamp(item.get('timestampSec') or 0)}]` "
            f"{text}"
            f"{_citation(evidence_by_source, 'implementationObservations', index, text)}"
        )
    return "\n".join(lines)
