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

from oc_worker.context_markdown import (
    format_timestamp as format_timestamp,  # noqa: F401 - re-exported for callers/tests
)
from oc_worker.context_markdown import (
    template_markdown,
)
from oc_worker.models import (
    DetailLevel,
    OCRObservation,
    Segment,
    VisualObservation,
    clamp_segments_to_duration,
)
from oc_worker.providers.http_status import provider_session
from oc_worker.providers.text.base import TextProvider, anchored_lines

log = logging.getLogger("oc_worker.context")

FORMAT_VERSION = 2


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
        "model": obs.model,
    }


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
    audio_present: bool | None = None,
    source_kind: str = "video",
    source_assets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ui_hierarchy: list[str] = []
    interactions: list[str] = []
    visible_text: list[Any] = []
    state_transitions: list[dict[str, Any]] = []
    implementation_observations: list[dict[str, Any]] = []
    visual_findings: list[dict[str, Any]] = []
    evidence_drafts: list[dict[str, Any]] = []
    cross_findings: list[dict[str, Any]] = []
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
        asset_index: int | None = None,
    ) -> None:
        nonlocal evidence_order
        if not text.strip():
            return
        entry: dict[str, Any] = {
            "kind": kind,
            "timestampSec": float(timestamp_sec),
            "certainty": certainty,
            "text": text,
            "source": {
                "collection": collection,
                "index": index,
                **({"assetIndex": asset_index} if asset_index is not None else {}),
            },
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

    for obs in observations:
        for field_name, claim in (
            ("sceneTitle", obs.sceneTitle),
            ("visualDescription", obs.visualDescription),
            ("layoutDescription", obs.layoutDescription),
        ):
            if claim:
                finding_index = len(visual_findings)
                finding = {
                    "field": field_name,
                    "text": claim,
                    "timestampSec": obs.timestampSec,
                    "certainty": obs.certainty.value,
                    "provider": obs.provider,
                    "model": obs.model,
                }
                if obs.frameId:
                    finding["frameId"] = obs.frameId
                visual_findings.append(finding)
                add_evidence(
                    kind="VISUAL",
                    collection="visualFindings",
                    index=finding_index,
                    text=claim,
                    timestamp_sec=obs.timestampSec,
                    certainty=obs.certainty.value,
                    asset_index=obs.sourceIndex,
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
                asset_index=obs.sourceIndex,
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
                asset_index=obs.sourceIndex,
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
                asset_index=obs.sourceIndex,
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
                asset_index=obs.sourceIndex,
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
                asset_index=obs.sourceIndex,
            )

    if source_kind in ("image", "pdf"):
        ordered_observations = sorted(
            observations,
            key=lambda item: (item.frameId or "", item.timestampSec),
        )
        previous: VisualObservation | None = None
        for current in ordered_observations:
            if previous is not None:
                previous_asset = previous.frameId or "source"
                current_asset = current.frameId or "source"
                before_text = set(previous.visibleText)
                after_text = set(current.visibleText)
                before_ui = set(previous.uiElements)
                after_ui = set(current.uiElements)
                comparisons = (
                    ("visible text added", after_text - before_text),
                    ("visible text removed", before_text - after_text),
                    ("UI elements added", after_ui - before_ui),
                    ("UI elements removed", before_ui - after_ui),
                )
                for label, values in comparisons:
                    if not values:
                        continue
                    changed_values = ", ".join(sorted(values))
                    text = (
                        f"{label} from {previous_asset} to "
                        f"{current_asset}: {changed_values}"
                    )
                    index = len(cross_findings)
                    cross_findings.append(
                        {
                            "from": previous_asset,
                            "to": current_asset,
                            "change": text,
                        }
                    )
                    add_evidence(
                        kind="VISUAL",
                        collection="crossImageFindings",
                        index=index,
                        text=text,
                        timestamp_sec=0.0,
                        certainty="OBSERVED",
                        asset_index=current.sourceIndex,
                    )
            previous = current
    seen_visible = {
        (obs.frameId, obs.timestampSec, text.strip().casefold())
        for obs in observations
        for text in obs.visibleText
        if text.strip()
    }
    for item in ocr:
        key = (item.frameId, item.timestampSec, item.text.strip().casefold())
        if key in seen_visible:
            continue
        seen_visible.add(key)
        index = len(visible_text)
        ocr_text = {
            "text": item.text,
            "confidence": item.confidence,
            "timestampSec": item.timestampSec,
        }
        if item.frameId:
            ocr_text["frameId"] = item.frameId
        visible_text.append(ocr_text)
        add_evidence(
            kind="OCR",
            collection="visibleText",
            index=index,
            text=item.text,
            timestamp_sec=item.timestampSec,
            certainty="OBSERVED",
            confidence=item.confidence,
            asset_index=item.sourceIndex,
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
    payload: dict[str, Any] = {
        "formatVersion": FORMAT_VERSION,
        "evidenceVersion": 1,
        "source": {
            "name": source_name,
            "kind": source_kind,
            "durationSec": duration_sec,
            "detailLevel": detail_level.value,
        },
        "sourceAssets": source_assets or [],
        "generatedAt": generated_at,
        "transcript": [segment.model_dump() for segment in segments],
        "timeline": timeline,
        "uiHierarchy": ui_hierarchy,
        "interactions": interactions,
        "visibleText": visible_text,
        "stateTransitions": state_transitions,
        "implementationObservations": implementation_observations,
        "visualFindings": visual_findings,
        "crossImageFindings": cross_findings,
        "evidence": evidence,
    }
    if audio_present is not None:
        payload["audioPresent"] = audio_present
    return payload


def build_context(
    *,
    source_name: str,
    duration_sec: float,
    detail_level: DetailLevel | str,
    segments: list[Segment],
    observations: list[VisualObservation],
    ocr: list[OCRObservation],
    timeline: list[dict[str, Any]],
    audio_present: bool | None = None,
    source_kind: str = "video",
    source_assets: list[dict[str, Any]] | None = None,
    text_provider: TextProvider | None = None,
    session_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Build the developer context; returns (markdown, json payload)."""
    level = DetailLevel(detail_level)
    # A speech model can run past the media end; keep evidence timestamps
    # inside the recording for both the CLI and worker callers.
    segments = clamp_segments_to_duration(segments, duration_sec)
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
        audio_present=audio_present,
        source_kind=source_kind,
        source_assets=source_assets,
    )
    markdown = template_markdown(payload)
    if text_provider is not None:
        try:
            with provider_session(session_id):
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
