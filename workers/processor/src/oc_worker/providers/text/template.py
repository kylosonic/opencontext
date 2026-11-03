"""Deterministic template text provider (always works, no credentials).

This is the GENERATING_CONTEXT fallback: it returns the baseline
markdown unchanged, so a job never fails just because no text-provider
credentials exist.
"""

from __future__ import annotations

from typing import Any


class TemplateTextProvider:
    name = "template"

    def refine(self, payload: dict[str, Any], baseline_markdown: str) -> str:
        return baseline_markdown
