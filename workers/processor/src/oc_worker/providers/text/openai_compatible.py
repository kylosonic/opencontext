"""OpenAI-compatible text provider (chat completions refinement)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from oc_worker.errors import TransientFailure
from oc_worker.providers.http_status import (
    openai_compatible_headers,
    raise_for_provider_status,
)
from oc_worker.providers.text.base import anchored_lines

_SYSTEM_PROMPT = (
    "You turn a structured analysis of a recorded software session into a "
    "developer-context Markdown document. The structured analysis JSON uses "
    "these collection shapes: uiHierarchy entries are strings naming UI "
    "elements, visibleText entries are strings (or OCR objects with text, "
    "confidence and timestampSec), interactions entries are one-sentence "
    "strings describing user actions, stateTransitions entries are "
    "{timestampSec, change} pairs, and implementationObservations entries "
    "are {timestampSec, note} pairs. Keep every fact, timestamp and "
    "certainty marker from the input. Evidence records use numeric IDs and "
    "source collection indexes. Use the provided evidence-linked Markdown "
    "lines. Preserve "
    "every evidence-bearing line and timeline row exactly, including claim "
    "text, timestamp, and marker. Never remove, alter, move, or invent "
    "evidence markers. Do not invent content. "
    "Output Markdown only."
)


class OpenAICompatibleTextProvider:
    name = "openai_compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        session_id: str | None = None,
        timeout: float = 120.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.session_id = session_id
        self._client = client or httpx.Client(timeout=timeout)

    def refine(self, payload: dict[str, Any], baseline_markdown: str) -> str:
        payload_json = json.dumps(payload, ensure_ascii=False)
        protected_lines = "\n".join(anchored_lines(baseline_markdown))
        body = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Structured analysis (JSON):\n{payload_json}\n\n"
                        f"Evidence-linked Markdown lines (preserve exactly):\n"
                        f"{protected_lines}\n\n"
                        "Polish only unmarked explanatory wording. Keep all "
                        "evidence-bearing lines and timeline rows byte for byte. "
                        "Produce the developer-context Markdown document now."
                    ),
                },
            ],
        }
        headers = openai_compatible_headers(
            self.api_key, self.base_url, self.session_id
        )
        try:
            response = self._client.post(
                f"{self.base_url}/chat/completions", headers=headers, json=body
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise TransientFailure(f"text refinement request failed: {exc}") from exc
        raise_for_provider_status("text", response)
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise TransientFailure("text provider returned an unexpected body") from exc
        text = str(content).strip()
        if not text:
            raise TransientFailure("text provider returned empty content")
        return text
