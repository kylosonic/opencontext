"""Deterministic vision provider for offline tests and demos.

This provider does not inspect image semantics. It verifies that a frame
was supplied, then emits a clearly labeled fixture observation so the
downstream timeline, evidence, and export paths can be tested without a
model or API key.
"""

from __future__ import annotations

import os
from typing import Any

from oc_worker.errors import PermanentFailure


class FixtureVisionProvider:
    name = "fixture"

    def analyze(self, frame_bytes: bytes, context: dict[str, Any]) -> dict[str, Any]:
        if not frame_bytes:
            raise PermanentFailure("fixture vision received an empty frame")
        timestamp = float(context.get("timestampSec") or 0.0)
        visible_text = os.getenv("FIXTURE_VISIBLE_TEXT", "OpenContext fixture frame")
        return {
            "certainty": "UNCERTAIN",
            "sceneTitle": os.getenv("FIXTURE_SCENE_TITLE", "Fixture scene"),
            "visualDescription": (
                f"Deterministic fixture observation at {timestamp:.1f}s "
                "(no vision model used)."
            ),
            "uiElements": [],
            "visibleText": [visible_text] if visible_text else [],
            "interactions": [],
            "layoutDescription": None,
            "designObservations": {},
            "importantChanges": [],
        }
