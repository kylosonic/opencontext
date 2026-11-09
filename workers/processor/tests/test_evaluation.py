"""Deterministic evaluation metric tests."""

from __future__ import annotations

import hashlib
import json
import wave
from pathlib import Path

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


def test_empty_reference_and_prediction_sets_are_perfect_matches() -> None:
    payload = {
        "transcript": [],
        "visibleText": [],
        "visualFindings": [],
        "uiHierarchy": [],
        "timeline": [],
    }
    truth = {
        "id": "hearing-only",
        "datasetId": "audio-v1",
        "transcript": "hello world",
        "ocrTexts": [],
        "visualKeywords": [],
    }

    result = evaluate_context(payload, truth, measurement_kind="measured")

    assert result["ocr"]["precision"] == 1.0
    assert result["ocr"]["recall"] == 1.0
    assert result["ocr"]["f1"] == 1.0
    assert result["visual"]["recall"] == 1.0


def test_published_hearing_artifacts_match_source_and_score() -> None:
    root = Path(__file__).resolve().parents[3]
    evaluation_dir = root / "docs" / "evaluation"
    dataset = json.loads(
        (evaluation_dir / "open-speech-hearing-dataset.json").read_text(
            encoding="utf-8"
        )
    )["item"]
    context = json.loads(
        (evaluation_dir / "opencode-go-hearing-context.json").read_text(
            encoding="utf-8"
        )
    )
    published = json.loads(
        (evaluation_dir / "opencode-go-hearing-evaluation.json").read_text(
            encoding="utf-8"
        )
    )

    audio = evaluation_dir / "harvard-osr-us-10.wav"
    assert hashlib.sha256(audio.read_bytes()).hexdigest() == dataset["sourceAudio"][
        "sha256"
    ]
    with wave.open(str(audio), "rb") as source:
        duration = source.getnframes() / source.getframerate()
    assert round(duration, 6) == dataset["sourceAudio"]["durationSec"]

    recomputed = evaluate_context(
        context,
        dataset,
        model_name="mimo-v2.6-pro",
        model_version="opencode-go-2026-11-09",
        measurement_kind="measured",
    )
    assert recomputed == published
