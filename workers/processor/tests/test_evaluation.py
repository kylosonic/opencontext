"""Deterministic evaluation metric tests."""

from __future__ import annotations

from oc_worker.evaluation import (
    character_error_rate,
    evaluate_context,
    normalize_text,
    word_error_rate,
)


def test_normalization_and_error_rates() -> None:
    assert normalize_text("Hello, WORLD!") == "hello world"
    assert word_error_rate("hello world", "hello there world") == 0.5
    assert word_error_rate("hello", "hello") == 0.0
    assert character_error_rate("cat", "cut") == 0.3333


def test_evaluation_reports_perfect_fixture_metrics() -> None:
    payload = {
        "transcript": [
            {
                "start": 0,
                "end": 2,
                "text": "This synthetic fixture demonstrates evidence links.",
            }
        ],
        "visibleText": ["OpenContext fixture", {"text": "OpenContext fixture"}],
        "visualFindings": [{"text": "Fixture scene with a deterministic observation"}],
        "uiHierarchy": ["Fixture scene"],
        "timeline": [
            {"title": "Fixture scene", "summary": "Deterministic observation"}
        ],
    }
    truth = {
        "id": "item-1",
        "datasetId": "synthetic-v1",
        "provenance": "generated",
        "license": "CC0-1.0",
        "transcript": "This synthetic fixture demonstrates evidence links.",
        "ocrTexts": ["OpenContext fixture"],
        "visualKeywords": ["Fixture scene", "deterministic observation"],
    }

    result = evaluate_context(
        payload,
        truth,
        model_name="fixture",
        model_version="1",
        measurement_kind="fixture-baseline",
    )

    assert result["transcript"]["wordErrorRate"] == 0.0
    assert result["transcript"]["characterErrorRate"] == 0.0
    assert result["ocr"]["f1"] == 1.0
    assert result["visual"]["recall"] == 1.0
    assert result["model"]["measurementKind"] == "fixture-baseline"
    assert result["dataset"]["license"] == "CC0-1.0"
