"""Native Gemini image analysis through the public Generative Language API."""

from __future__ import annotations

import base64
from typing import Any

import httpx

from oc_worker.errors import TransientFailure
from oc_worker.providers.http_status import raise_for_provider_status
from oc_worker.providers.vision.openai_compatible import _normalize, _parse_json_object


def gemini_prompt(context: dict[str, Any]) -> str:
    source = context.get("sourceName") or "provided by the user"
    return (
        "Analyze this synthetic or user-provided software screenshot. "
        "Return ONLY a JSON object with exactly these keys: "
        '\"certainty\" (\"OBSERVED\"|\"INFERRED\"|\"UNCERTAIN\"), \"sceneTitle\", '
        '\"visualDescription\", \"uiElements\" (array of short strings), '
        '\"visibleText\" (array of text exactly visible on screen), '
        '\"interactions\" (array of inferred user actions; empty when no action '
        'is visible), \"layoutDescription\", \"designObservations\" (object of '
        'string key-values), and \"importantChanges\" (array). Do not include '
        f'markdown or commentary. Source: {source}. Detail: '
        f"{context.get('detailLevel') or 'MEDIUM'}."
    )


class GeminiVisionProvider:
    name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        timeout: float = 120.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model.removeprefix("models/")
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=timeout)

    def analyze(self, frame_bytes: bytes, context: dict[str, Any]) -> dict[str, Any]:
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "image/jpeg",
                                "data": base64.b64encode(frame_bytes).decode("ascii"),
                            }
                        },
                        {"text": gemini_prompt(context)},
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
            },
        }
        try:
            response = self._client.post(
                f"{self.base_url}/models/{self.model}:generateContent",
                headers={"x-goog-api-key": self.api_key},
                json=payload,
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise TransientFailure(f"Gemini vision request failed: {exc}") from exc
        raise_for_provider_status("Gemini vision", response)
        try:
            parts = response.json()["candidates"][0]["content"]["parts"]
            text = next(
                str(part["text"])
                for part in parts
                if isinstance(part, dict)
                and not part.get("thought")
                and isinstance(part.get("text"), str)
                and part["text"].strip()
            )
        except (ValueError, KeyError, IndexError, TypeError, StopIteration) as exc:
            raise TransientFailure("Gemini returned no image analysis") from exc
        observation = _normalize(_parse_json_object(str(text)))
        observation["provider"] = "gemini"
        observation["model"] = self.model
        return observation
