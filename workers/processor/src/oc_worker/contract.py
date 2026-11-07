"""Emit representative worker payloads for the cross-language contract test.

The TypeScript test imports this module through a Python subprocess and
validates every stage payload with the shared Zod schemas. The sample is
built from the same pydantic models and context builder used by the worker,
so a renamed field or incompatible value type becomes a test failure.
"""

from __future__ import annotations

import json
from typing import Any

from oc_worker.aggregation import build_timeline
from oc_worker.context import build_context
from oc_worker.models import DetailLevel, OCRObservation, Segment, VisualObservation


def build_contract_sample() -> dict[str, Any]:
    segments = [
        Segment(start=0.0, end=1.5, text="Open the settings page."),
        Segment(start=1.5, end=3.0, text="Save the new preference."),
    ]
    observations = [
        VisualObservation(
            timestampSec=0.0,
            certainty="OBSERVED",
            sceneTitle="Settings",
            visualDescription="A settings form with a Save button.",
            uiElements=["Save button"],
            visibleText=["Settings"],
            interactions=["The user opens Settings."],
            layoutDescription="Single-column form",
            designObservations={"layout": "Single-column form"},
            importantChanges=["The Save button becomes enabled."],
            provider="contract-sample",
        ),
        VisualObservation(
            timestampSec=2.0,
            certainty="INFERRED",
            sceneTitle="Saved",
            visualDescription="A confirmation message is visible.",
            uiElements=["Confirmation banner"],
            visibleText=["Changes saved"],
            interactions=["The user saves the preference."],
            layoutDescription="Single-column form",
            designObservations={"feedback": "Confirmation banner"},
            importantChanges=[],
            provider="contract-sample",
        ),
    ]
    ocr = [
        OCRObservation(
            timestampSec=0.0,
            text="Settings",
            confidence=0.99,
            provider="contract-sample",
        ),
        OCRObservation(
            timestampSec=2.0,
            text="Changes saved",
            confidence=0.98,
            provider="contract-sample",
        ),
    ]
    timeline = build_timeline(observations, 3.0)
    markdown, context_json = build_context(
        source_name="contract-fixture.mp4",
        duration_sec=3.0,
        detail_level=DetailLevel.MEDIUM,
        segments=segments,
        observations=observations,
        ocr=ocr,
        timeline=timeline,
        text_provider=None,
    )
    return {
        "progress": {
            "stage": "ANALYZING",
            "stageStatus": "RUNNING",
            "progress": 50,
            "message": "Analyzing visual frames",
        },
        "extracting": {
            "durationSec": 3.0,
            "width": 640,
            "height": 360,
            "audioPresent": True,
            "frameCount": 3,
        },
        "transcribing": {
            "segments": [segment.model_dump() for segment in segments],
        },
        "analyzing": {
            "observations": [
                observation.model_dump(exclude_none=True) for observation in observations
            ],
            "ocr": [item.model_dump(exclude_none=True) for item in ocr],
        },
        "aggregating": {"timeline": timeline},
        "generatingContext": {
            "markdown": markdown,
            "json": context_json,
        },
    }


def main() -> None:
    print(json.dumps(build_contract_sample(), sort_keys=True))


if __name__ == "__main__":
    main()
