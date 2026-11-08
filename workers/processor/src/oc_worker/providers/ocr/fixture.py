"""Deterministic offline OCR output for tests and credential-free demos."""

from __future__ import annotations

import os
from typing import Any


class FixtureOcrProvider:
    name = "fixture"

    def extract(
        self,
        frame_bytes: bytes,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        del frame_bytes, context
        text = os.getenv("FIXTURE_VISIBLE_TEXT", "OpenContext fixture").strip()
        return [{"text": text}] if text else []
