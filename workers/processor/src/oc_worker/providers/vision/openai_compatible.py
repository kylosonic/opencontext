"""OpenAI-compatible vision provider (chat completions + image input).

Sends the frame as a base64 data URL and requires a strict JSON
observation. Response parsing is tolerant of code fences; failures are
classified transient/permanent for the pipeline's retry loop.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import httpx

from oc_worker.errors import TransientFailure
from oc_worker.providers.http_status import raise_for_provider_status

_SYSTEM_PROMPT = (
    "You analyze individual frames of a recorded software session. "
    "Respond with ONLY a JSON object using exactly these keys: "
    '"certainty" ("OBSERVED"|"INFERRED"|"UNCERTAIN"), "sceneTitle", '
    '"visualDescription", "uiElements" (array of short strings, one per '
    'visible UI element), "visibleText" (array of strings with the text '
    'exactly as shown on screen), "interactions" (array of one-sentence '
    'strings describing each user action, e.g. "The user clicks Save"), '
    '"layoutDescription", "designObservations" (JSON object of key to '
    'string-value pairs, e.g. {"layout": "Rounded cards"}), '
    '"importantChanges" (array of strings describing state or UI '
    "changes). Never include markdown or extra text."
)


def _parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise TransientFailure("vision provider returned no JSON object")
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except ValueError as exc:
        raise TransientFailure("vision provider returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise TransientFailure("vision provider returned a non-object JSON value")
    return parsed


class OpenAICompatibleVisionProvider:
    name = "openai_compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 120.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._client = client or httpx.Client(timeout=timeout)

    def analyze(self, frame_bytes: bytes, context: dict[str, Any]) -> dict[str, Any]:
        encoded = base64.b64encode(frame_bytes).decode("ascii")
        user_text = (
            f"Frame at {context.get('timestampSec')}s of "
            f"{context.get('sourceName') or 'the video'} "
            f"(detail level {context.get('detailLevel')}). Analyze this frame."
        )
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
                        },
                        {"type": "text", "text": user_text},
                    ],
                },
            ],
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            response = self._client.post(
                f"{self.base_url}/chat/completions", headers=headers, json=payload
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise TransientFailure(f"vision request failed: {exc}") from exc
        raise_for_provider_status("vision", response)
        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise TransientFailure("vision provider returned an unexpected body") from exc
        return _normalize(_parse_json_object(str(content)))


def _normalize(raw: dict[str, Any]) -> dict[str, Any]:
    interactions = raw.get("interactions") or []
    for item in interactions:
        if isinstance(item, dict):
            item.setdefault("certainty", "INFERRED")
    observation: dict[str, Any] = {
        "certainty": str(raw.get("certainty") or "OBSERVED").upper(),
        "sceneTitle": raw.get("sceneTitle"),
        "visualDescription": raw.get("visualDescription"),
        "uiElements": raw.get("uiElements") or [],
        "visibleText": raw.get("visibleText") or [],
        "interactions": interactions,
        "layoutDescription": raw.get("layoutDescription"),
        "designObservations": raw.get("designObservations") or [],
        "importantChanges": raw.get("importantChanges") or [],
    }
    if observation["certainty"] not in ("OBSERVED", "INFERRED", "UNCERTAIN"):
        observation["certainty"] = "OBSERVED"
    return observation
