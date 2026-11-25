"""Deterministic context compression helpers for segments, observations, and payloads."""

from __future__ import annotations

import json
import re
from typing import Any

from oc_worker.models import Certainty, Segment, VisualObservation

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")
_VALID_MODES = ("none", "compact", "aggressive")


def normalize_compression_mode(value: str | None) -> str:
    """Normalize a compression mode into none, compact, or aggressive."""
    normalized = (value or "none").strip().lower()
    if normalized in _VALID_MODES:
        return normalized
    return "none"


def compress_segments(
    segments: list[Segment],
    *,
    mode: str = "compact",
) -> list[Segment]:
    """Merge adjacent transcript segments separated by short silence gaps."""
    resolved = normalize_compression_mode(mode)
    if resolved == "none" or len(segments) <= 1:
        return list(segments)

    max_gap_sec = 4.0 if resolved == "aggressive" else 1.5
    max_merged_chars = 4_000
    ordered = sorted(segments, key=lambda item: (item.start, item.end))
    merged: list[Segment] = [ordered[0]]

    for seg in ordered[1:]:
        prev = merged[-1]
        gap = seg.start - prev.end
        prev_text = prev.text.strip()
        next_text = seg.text.strip()
        combined_len = len(prev_text) + 1 + len(next_text)
        if gap <= max_gap_sec and combined_len <= max_merged_chars:
            if not next_text or next_text.casefold() == prev_text.casefold():
                new_text = prev_text
            elif not prev_text:
                new_text = next_text
            else:
                new_text = f"{prev_text} {next_text}"
            merged[-1] = Segment(
                start=prev.start,
                end=max(prev.end, seg.end),
                text=new_text,
            )
        else:
            merged.append(seg)

    return merged


def _observation_tokens(obs: VisualObservation) -> set[str]:
    parts: list[str] = [
        obs.sceneTitle or "",
        obs.visualDescription or "",
        obs.layoutDescription or "",
        *obs.uiElements,
        *obs.visibleText,
    ]
    tokens: set[str] = set()
    for part in parts:
        for match in _TOKEN_RE.findall(part.lower()):
            tokens.add(match)
    return tokens


def _jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    union = left | right
    if not union:
        return 1.0
    return len(left & right) / len(union)


def _merge_string_lists(first: list[str], second: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for item in [*first, *second]:
        cleaned = item.strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key not in seen:
            seen.add(key)
            merged.append(item)
    return merged


def _combine_certainty(first: Certainty, second: Certainty) -> Certainty:
    rank = {
        Certainty.OBSERVED: 0,
        Certainty.INFERRED: 1,
        Certainty.UNCERTAIN: 2,
    }
    return first if rank[first] >= rank[second] else second


def _merge_observation_pair(
    base: VisualObservation,
    nxt: VisualObservation,
) -> VisualObservation:
    design = dict(base.designObservations)
    for key, value in nxt.designObservations.items():
        design.setdefault(key, value)
    return VisualObservation(
        timestampSec=min(base.timestampSec, nxt.timestampSec),
        certainty=_combine_certainty(base.certainty, nxt.certainty),
        frameId=base.frameId or nxt.frameId,
        sourceIndex=base.sourceIndex if base.sourceIndex is not None else nxt.sourceIndex,
        sceneTitle=base.sceneTitle or nxt.sceneTitle,
        visualDescription=base.visualDescription or nxt.visualDescription,
        uiElements=_merge_string_lists(base.uiElements, nxt.uiElements),
        visibleText=_merge_string_lists(base.visibleText, nxt.visibleText),
        interactions=_merge_string_lists(base.interactions, nxt.interactions),
        layoutDescription=base.layoutDescription or nxt.layoutDescription,
        designObservations=design,
        importantChanges=_merge_string_lists(
            base.importantChanges, nxt.importantChanges
        ),
        provider=base.provider or nxt.provider,
        model=base.model or nxt.model,
    )


def compress_observations(
    observations: list[VisualObservation],
    *,
    mode: str = "compact",
) -> list[VisualObservation]:
    """Merge consecutive visually similar observations while preserving evidence unions."""
    resolved = normalize_compression_mode(mode)
    if resolved == "none" or len(observations) <= 1:
        return list(observations)

    threshold = 0.50 if resolved == "aggressive" else 0.72
    ordered = sorted(observations, key=lambda item: item.timestampSec)
    merged: list[VisualObservation] = [ordered[0]]
    prev_tokens = _observation_tokens(ordered[0])

    for obs in ordered[1:]:
        prev = merged[-1]
        cur_tokens = _observation_tokens(obs)
        same_asset = (
            prev.sourceIndex is None
            or obs.sourceIndex is None
            or prev.sourceIndex == obs.sourceIndex
        )
        if same_asset and _jaccard_similarity(prev_tokens, cur_tokens) >= threshold:
            combined = _merge_observation_pair(prev, obs)
            merged[-1] = combined
            prev_tokens = _observation_tokens(combined)
        else:
            merged.append(obs)
            prev_tokens = cur_tokens

    return merged


def estimate_tokens(payload: dict[str, Any]) -> int:
    """Estimate serialized JSON token count deterministically (~4 chars/token)."""
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return max(1, (len(serialized) + 3) // 4)


def _prune_redundant_evidence(payload: dict[str, Any], max_tokens: int) -> None:
    """Trim redundant lower-priority evidence rows until within max_tokens (min 1)."""
    evidence = list(payload.get("evidence") or [])
    if len(evidence) <= 1:
        return

    seen_texts: set[str] = set()
    unique_evidence: list[dict[str, Any]] = []
    for item in evidence:
        text_key = f"{item.get('kind')}:{str(item.get('text') or '').strip().casefold()}"
        if text_key in seen_texts and len(evidence) > 1:
            continue
        seen_texts.add(text_key)
        unique_evidence.append(item)

    if unique_evidence:
        evidence = unique_evidence

    payload["evidence"] = evidence
    while len(evidence) > 1 and estimate_tokens(payload) > max_tokens:
        drop_idx = len(evidence) - 1
        for idx in range(len(evidence) - 1, -1, -1):
            collection = (evidence[idx].get("source") or {}).get("collection")
            if collection in (
                "implementationObservations",
                "uiHierarchy",
                "visualFindings",
                "visibleText",
            ):
                drop_idx = idx
                break
        evidence.pop(drop_idx)
        payload["evidence"] = evidence

    for new_id, item in enumerate(evidence, start=1):
        item["id"] = new_id
    payload["evidence"] = evidence


def apply_context_compression(
    payload: dict[str, Any],
    *,
    mode: str = "none",
    max_tokens: int = 0,
    original_segments: int | None = None,
    original_observations: int | None = None,
) -> dict[str, Any]:
    """Enforce optional token budget and record compression metadata on the payload."""
    resolved = normalize_compression_mode(mode)
    bounded_max = max(0, int(max_tokens))
    if resolved == "none" and bounded_max <= 0:
        return payload

    if bounded_max > 0 and estimate_tokens(payload) > bounded_max:
        _prune_redundant_evidence(payload, bounded_max)

    compressed_segments = len(payload.get("transcript") or [])
    compressed_timeline = len(payload.get("timeline") or [])
    payload["compression"] = {
        "mode": resolved,
        "maxTokens": bounded_max,
        "estimatedTokens": estimate_tokens(payload),
        "segmentsKept": compressed_segments,
        "timelineEntriesKept": compressed_timeline,
        "evidenceKept": len(payload.get("evidence") or []),
        **(
            {"originalSegments": original_segments}
            if original_segments is not None
            else {}
        ),
        **(
            {"originalObservations": original_observations}
            if original_observations is not None
            else {}
        ),
    }
    return payload
