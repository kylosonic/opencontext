"""Base contract for text providers (developer-context refinement)."""

from __future__ import annotations

import re
from typing import Any, Protocol

_EVIDENCE_MARKER = re.compile(
    r"\[E\d{4,} · \d{2,}:\d{2} · (?:Observed|Inferred|Uncertain)\]"
)
_TIMELINE_RANGE = re.compile(
    r"(?P<tick>`?)\[\d{2,}:\d{2}[-–]\d{2,}:\d{2}\](?P=tick)"
)


def anchored_lines(markdown: str) -> tuple[str, ...]:
    """Lines whose claims or timeline ranges must remain unchanged."""
    return tuple(
        line
        for line in markdown.splitlines()
        if _EVIDENCE_MARKER.search(line) or _TIMELINE_RANGE.search(line)
    )


class TextProvider(Protocol):
    """Refine the structured analysis into developer-context markdown."""

    name: str

    def refine(self, payload: dict[str, Any], baseline_markdown: str) -> str:
        """Return refined markdown; callers fall back to the baseline on error."""
        ...
