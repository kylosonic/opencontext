"""Contract for extracting visible text independently from the vision model."""

from __future__ import annotations

from typing import Any, Protocol


class OcrProvider(Protocol):
    name: str

    def extract(
        self,
        frame_bytes: bytes,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Return rows with text and optional confidence in the range 0..1."""
        ...
