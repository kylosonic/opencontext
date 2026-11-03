"""Deterministic developer-context builder (markdown + JSON).

Sections: header (source name, duration, generated date, detail level),
timeline rows, transcript, UI hierarchy, navigation, interactions,
visible text, state transitions, implementation observations. A text
provider may refine the markdown; any refinement failure falls back to
the template baseline so GENERATING_CONTEXT never fails for lack of a
model.

Timeline (formatVersion 2): the ``timeline`` list is passed through as
canonical scene rows ``{start, end, title?, summary}`` built by
aggregation.build_timeline (packages/schemas TimelineEntrySchema). The
"## Timeline" markdown section renders those rows as continuous
scene-level ranges ``- `[mm:ss-mm:ss]` **title** — summary``; per-kind
transcript/OCR entries no longer exist on the timeline (transcript and
OCR keep their own collections/sections below).

Canonical observation payload (packages/schemas, demo-result.json):
uiElements/visibleText/interactions/importantChanges are string arrays and
designObservations is a ``dict[str, str]`` record; this module maps them to
the context JSON as:

- uiElements → uiHierarchy entries (strings)
- interactions → interactions entries (sentence strings)
- importantChanges (strings) → stateTransitions {"timestampSec", "change"}
- designObservations (record) → implementationObservations
  {"timestampSec", "note": "key: value"} — keys sorted for determinism
- visibleText strings + OCR entries → visibleText entries

Markdown choices (documented, deterministic): UI Hierarchy bullets render a
string element verbatim or "label (role)" for legacy dict entries;
Interactions bullets render canonical sentence strings verbatim (legacy
{action,target} dict entries keep the "action on target (inferred)" form);
the Navigation section only recognizes navigation verbs on legacy dict
interaction entries, so canonical string payloads print "_No navigation
observed._" (their sentences are never dropped — they render under
Interactions). Evidence IDs in Markdown and JSON point each claim back to a
timestamp and certainty label; interaction evidence is always marked inferred.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from oc_worker.models import DetailLevel, OCRObservation, Segment, VisualObservation
from oc_worker.providers.text.base import TextProvider, anchored_lines

log = logging.getLogger("oc_worker.context")

FORMAT_VERSION = 2


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


def _observation_payload(obs: VisualObservation) -> dict[str, Any]:
    return {
        "timestampSec": obs.timestampSec,
        "certainty": obs.certainty.value,
        "sceneTitle": obs.sceneTitle,
        "visualDescription": obs.visualDescription,
        "uiElements": obs.uiElements,
        "visibleText": obs.visibleText,
        "interactions": obs.interactions,
        "layoutDescription": obs.layoutDescription,
        "designObservations": obs.designObservations,
        "importantChanges": obs.importantChanges,
        "provider": obs.provider,
    }


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


def _build_json_payload(
    *,
    source_name: str,
    duration_sec: float,
    detail_level: DetailLevel,
    segments: list[Segment],
    observations: list[VisualObservation],
    ocr: list[OCRObservation],
    timeline: list[dict[str, Any]],
    generated_at: str,
) -> dict[str, Any]:
    ui_hierarchy: list[str] = []
    interactions: list[str] = []
    visible_text: list[Any] = []
    state_transitions: list[dict[str, Any]] = []
    implementation_observations: list[dict[str, Any]] = []
    visual_findings: list[dict[str, Any]] = []
    evidence_drafts: list[dict[str, Any]] = []
    evidence_order = 0

    def add_evidence(
        *,
        kind: str,
        collection: str,
        index: int,
        text: str,
        timestamp_sec: float,
        certainty: str,
        end_sec: float | None = None,
        confidence: float | None = None,
    ) -> None:
        nonlocal evidence_order
        if not text.strip():
            return
        entry: dict[str, Any] = {
            "kind": kind,
            "timestampSec": float(timestamp_sec),
            "certainty": certainty,
            "text": text,
            "source": {"collection": collection, "index": index},
            "_order": evidence_order,
        }
        if end_sec is not None:
            entry["endSec"] = float(end_sec)
        if confidence is not None:
            entry["confidence"] = confidence
        evidence_order += 1
        evidence_drafts.append(entry)

    for segment_index, segment in enumerate(segments):
        add_evidence(
            kind="TRANSCRIPT",
            collection="transcript",
            index=segment_index,
            text=segment.text,
            timestamp_sec=segment.start,
            end_sec=segment.end,
            certainty="OBSERVED",
        )

    for observation_index, obs in enumerate(observations):
        for field_name, claim in (
            ("sceneTitle", obs.sceneTitle),
            ("visualDescription", obs.visualDescription),
            ("layoutDescription", obs.layoutDescription),
        ):
            if claim:
                finding_index = len(visual_findings)
                visual_findings.append(
                    {
                        "field": field_name,
                        "text": claim,
                        "timestampSec": obs.timestampSec,
                        "certainty": obs.certainty.value,
                    }
                )
                add_evidence(
                    kind="VISUAL",
                    collection="visualFindings",
                    index=finding_index,
                    text=claim,
                    timestamp_sec=obs.timestampSec,
                    certainty=obs.certainty.value,
                )

        for element in obs.uiElements:
            index = len(ui_hierarchy)
            ui_hierarchy.append(element)
            add_evidence(
                kind="VISUAL",
                collection="uiHierarchy",
                index=index,
                text=element,
                timestamp_sec=obs.timestampSec,
                certainty=obs.certainty.value,
            )

        for interaction in obs.interactions:
            index = len(interactions)
            interactions.append(interaction)
            add_evidence(
                kind="VISUAL",
                collection="interactions",
                index=index,
                text=interaction,
                timestamp_sec=obs.timestampSec,
                certainty="INFERRED",
            )

        for text in obs.visibleText:
            index = len(visible_text)
            visible_text.append(text)
            add_evidence(
                kind="VISUAL",
                collection="visibleText",
                index=index,
                text=text,
                timestamp_sec=obs.timestampSec,
                certainty=obs.certainty.value,
            )

        for change in obs.importantChanges:
            index = len(state_transitions)
            state_transitions.append({"timestampSec": obs.timestampSec, "change": change})
            add_evidence(
                kind="VISUAL",
                collection="stateTransitions",
                index=index,
                text=change,
                timestamp_sec=obs.timestampSec,
                certainty=obs.certainty.value,
            )
        # deterministic key order: implementation notes are sorted by key
        for key in sorted(obs.designObservations):
            note = f"{key}: {obs.designObservations[key]}"
            index = len(implementation_observations)
            implementation_observations.append(
                {"timestampSec": obs.timestampSec, "note": note}
            )
            add_evidence(
                kind="VISUAL",
                collection="implementationObservations",
                index=index,
                text=note,
                timestamp_sec=obs.timestampSec,
                certainty=obs.certainty.value,
            )
    for item in ocr:
        index = len(visible_text)
        visible_text.append(
            {"text": item.text, "confidence": item.confidence, "timestampSec": item.timestampSec}
        )
        add_evidence(
            kind="OCR",
            collection="visibleText",
            index=index,
            text=item.text,
            timestamp_sec=item.timestampSec,
            certainty="OBSERVED",
            confidence=item.confidence,
        )

    evidence: list[dict[str, Any]] = []
    for evidence_id, draft in enumerate(
        sorted(
            evidence_drafts,
            key=lambda item: (item["timestampSec"], item["_order"]),
        ),
        start=1,
    ):
        entry = {key: value for key, value in draft.items() if key != "_order"}
        entry["id"] = evidence_id
        evidence.append(entry)
    return {
        "formatVersion": FORMAT_VERSION,
        "evidenceVersion": 1,
        "source": {
            "name": source_name,
            "durationSec": duration_sec,
            "detailLevel": detail_level.value,
        },
        "generatedAt": generated_at,
        "transcript": [segment.model_dump() for segment in segments],
        "timeline": timeline,
        "uiHierarchy": ui_hierarchy,
        "interactions": interactions,
        "visibleText": visible_text,
        "stateTransitions": state_transitions,
        "implementationObservations": implementation_observations,
        "visualFindings": visual_findings,
        "evidence": evidence,
    }


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
        f"- **Duration:** {format_timestamp(source.get('durationSec') or 0)}",
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
        lines.append("_No audio track detected — transcription was skipped._")
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
        and str(item.get("action") or "").lower() in ("navigate", "click", "open", "route")
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


def build_context(
    *,
    source_name: str,
    duration_sec: float,
    detail_level: DetailLevel | str,
    segments: list[Segment],
    observations: list[VisualObservation],
    ocr: list[OCRObservation],
    timeline: list[dict[str, Any]],
    text_provider: TextProvider | None = None,
) -> tuple[str, dict[str, Any]]:
    """Build the developer context; returns (markdown, json payload)."""
    level = DetailLevel(detail_level)
    generated_at = datetime.now(UTC).isoformat(timespec="seconds")
    payload = _build_json_payload(
        source_name=source_name,
        duration_sec=duration_sec,
        detail_level=level,
        segments=segments,
        observations=observations,
        ocr=ocr,
        timeline=timeline,
        generated_at=generated_at,
    )
    markdown = template_markdown(payload)
    if text_provider is not None:
        try:
            refined_markdown = text_provider.refine(payload, markdown)
            if anchored_lines(refined_markdown) == anchored_lines(markdown):
                markdown = refined_markdown
            else:
                log.warning(
                    "text provider changed evidence-linked lines; "
                    "using template fallback"
                )
        except Exception:  # noqa: BLE001 - template fallback is the whole point
            log.warning("text provider refinement failed; using template fallback")
    return markdown, payload


def dump_json(payload: dict[str, Any]) -> str:
    """JSON rendering of the payload (deterministic key order)."""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)
