"""Deterministic transcript, OCR, and visual evaluation metrics."""

from __future__ import annotations

import re
from typing import Any

_WORD_RE = re.compile(r"[a-z0-9]+")
_PUNCTUATION_RE = re.compile(r"[^a-z0-9]+")


def normalize_words(text: str) -> list[str]:
    return _WORD_RE.findall(text.casefold())


def normalize_text(text: str) -> str:
    return " ".join(normalize_words(text))


def _edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for ref_index, ref_item in enumerate(reference, start=1):
        current = [ref_index]
        for hyp_index, hyp_item in enumerate(hypothesis, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[hyp_index] + 1,
                    previous[hyp_index - 1] + (ref_item != hyp_item),
                )
            )
        previous = current
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref_words = normalize_words(reference)
    hyp_words = normalize_words(hypothesis)
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    return round(_edit_distance(ref_words, hyp_words) / len(ref_words), 4)


def character_error_rate(reference: str, hypothesis: str) -> float:
    ref_chars = list(_PUNCTUATION_RE.sub("", reference.casefold()))
    hyp_chars = list(_PUNCTUATION_RE.sub("", hypothesis.casefold()))
    if not ref_chars:
        return 0.0 if not hyp_chars else 1.0
    return round(_edit_distance(ref_chars, hyp_chars) / len(ref_chars), 4)


def _context_texts(payload: dict[str, Any]) -> list[str]:
    texts: list[str] = []
    for item in payload.get("visibleText") or []:
        if isinstance(item, str):
            texts.append(item)
        elif isinstance(item, dict) and item.get("text"):
            texts.append(str(item["text"]))
    return texts


def _visual_search_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for finding in payload.get("visualFindings") or []:
        if isinstance(finding, dict) and finding.get("text"):
            parts.append(str(finding["text"]))
    parts.extend(str(item) for item in payload.get("uiHierarchy") or [])
    for item in payload.get("timeline") or []:
        if isinstance(item, dict):
            parts.append(str(item.get("title") or ""))
            parts.append(str(item.get("summary") or ""))
    return normalize_text(" ".join(parts))


def _set_metrics(expected: list[str], predicted: list[str]) -> dict[str, float | int]:
    expected_set = {normalize_text(item) for item in expected if normalize_text(item)}
    predicted_set = {normalize_text(item) for item in predicted if normalize_text(item)}
    true_positive = len(expected_set & predicted_set)
    precision = true_positive / len(predicted_set) if predicted_set else 1.0
    recall = true_positive / len(expected_set) if expected_set else 1.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall
        else 0.0
    )
    return {
        "expected": len(expected_set),
        "predicted": len(predicted_set),
        "matched": true_positive,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def evaluate_context(
    payload: dict[str, Any],
    truth: dict[str, Any],
    *,
    model_name: str = "unknown",
    model_version: str = "unknown",
    measurement_kind: str = "measured",
) -> dict[str, Any]:
    """Compare one OpenContext payload with a ground-truth evaluation item."""
    transcript_truth = str(truth.get("transcript") or "")
    transcript_hypothesis = " ".join(
        str(item.get("text") or "")
        for item in payload.get("transcript") or []
        if isinstance(item, dict)
    )
    expected_ocr = [str(item) for item in truth.get("ocrTexts") or []]
    expected_visual = [str(item) for item in truth.get("visualKeywords") or []]
    visual_text = _visual_search_text(payload)
    visual_matches = {
        keyword: normalize_text(keyword) in visual_text for keyword in expected_visual
    }
    visual_recall = (
        round(sum(visual_matches.values()) / len(visual_matches), 4)
        if visual_matches
        else 1.0
    )
    return {
        "evaluationVersion": 1,
        "dataset": {
            "id": truth.get("datasetId"),
            "item": truth.get("id"),
            "provenance": truth.get("provenance"),
            "license": truth.get("license"),
        },
        "model": {
            "name": model_name,
            "version": model_version,
            "measurementKind": measurement_kind,
        },
        "transcript": {
            "reference": transcript_truth,
            "hypothesis": transcript_hypothesis,
            "wordErrorRate": word_error_rate(transcript_truth, transcript_hypothesis),
            "characterErrorRate": character_error_rate(
                transcript_truth, transcript_hypothesis
            ),
        },
        "ocr": _set_metrics(expected_ocr, _context_texts(payload)),
        "visual": {
            "keywords": visual_matches,
            "recall": visual_recall,
        },
    }
