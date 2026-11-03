"""Base contract for vision providers."""

from __future__ import annotations

from typing import Any, Protocol


class VisionProvider(Protocol):
    """Analyze one video frame into a structured observation dict.

    Contract fields: certainty (OBSERVED|INFERRED|UNCERTAIN), sceneTitle,
    visualDescription, uiElements, visibleText, interactions (always
    INFERRED), layoutDescription, designObservations, importantChanges.
    """

    name: str

    def analyze(self, frame_bytes: bytes, context: dict[str, Any]) -> dict[str, Any]:
        """Return an observation dict for one frame."""
        ...
