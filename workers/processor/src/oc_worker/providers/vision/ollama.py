"""Ollama vision provider (local `/api/chat`, `format: json`)."""

from __future__ import annotations

import base64
from typing import Any

import httpx

from oc_worker.errors import TransientFailure
from oc_worker.providers.http_status import raise_for_provider_status
from oc_worker.providers.vision.openai_compatible import _normalize, _parse_json_object

_PROMPT = (
    "Analyze this frame of a recorded software session. Respond with ONLY a "
    "JSON object using exactly these keys: certainty (OBSERVED|INFERRED|UNCERTAIN), "
    "sceneTitle, visualDescription, uiElements (array of short strings, one "
    "per visible UI element), visibleText (array of strings with the text "
    "exactly as shown on screen), interactions (array of one-sentence "
    'strings describing each user action, e.g. "The user clicks Save"), '
    "layoutDescription, designObservations (JSON object of key to "
    'string-value pairs, e.g. {"layout": "Rounded cards"}), importantChanges '
    "(array of strings describing state or UI changes)."
)


class OllamaVisionProvider:
    name = "ollama"

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        timeout: float = 300.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._client = client or httpx.Client(timeout=timeout)

    def analyze(self, frame_bytes: bytes, context: dict[str, Any]) -> dict[str, Any]:
        encoded = base64.b64encode(frame_bytes).decode("ascii")
        payload = {
            "model": self.model,
            "stream": False,
            "format": "json",
            "messages": [
                {
                    "role": "user",
                    "content": _PROMPT,
                    "images": [encoded],
                }
            ],
        }
        try:
            response = self._client.post(f"{self.base_url}/api/chat", json=payload)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise TransientFailure(f"ollama vision request failed: {exc}") from exc
        raise_for_provider_status("ollama vision", response)
        try:
            body = response.json()
            content = body["message"]["content"]
        except (ValueError, KeyError, TypeError) as exc:
            raise TransientFailure("ollama vision provider returned an unexpected body") from exc
        return _normalize(_parse_json_object(str(content)))
