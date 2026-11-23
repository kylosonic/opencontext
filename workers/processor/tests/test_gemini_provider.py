"""Offline tests for the native Gemini vision request and response contract."""

from __future__ import annotations

import base64
import json

import httpx
import pytest

from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.providers.vision.gemini import GeminiVisionProvider


def _provider(handler) -> GeminiVisionProvider:
    return GeminiVisionProvider(
        api_key="gemini-test-secret",
        model="gemini-test-model",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_gemini_sends_native_inline_image_and_normalizes_observation() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "certainty": "OBSERVED",
                                            "sceneTitle": "Checkout",
                                            "visibleText": ["Order 1042", "Pay now"],
                                            "uiElements": ["Pay now button"],
                                            "designObservations": {"layout": "Card"},
                                        }
                                    )
                                }
                            ]
                        }
                    }
                ]
            },
        )

    observation = _provider(handler).analyze(
        b"jpeg-bytes",
        {
            "sourceKind": "image",
            "sourceName": "reference.jpg",
            "detailLevel": "MEDIUM",
        },
    )

    assert seen["path"] == "/v1beta/models/gemini-test-model:generateContent"
    assert seen["key"] == "gemini-test-secret"
    parts = seen["body"]["contents"][0]["parts"]
    assert parts[0]["inlineData"]["mimeType"] == "image/jpeg"
    assert base64.b64decode(parts[0]["inlineData"]["data"]) == b"jpeg-bytes"
    assert "reference.jpg" in parts[1]["text"]
    assert "thinkingConfig" not in seen["body"]["generationConfig"]
    assert observation["sceneTitle"] == "Checkout"
    assert observation["visibleText"] == ["Order 1042", "Pay now"]
    assert observation["designObservations"] == {"layout": "Card"}
    assert observation["provider"] == "gemini"
    assert observation["model"] == "gemini-test-model"


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_gemini_rejects_invalid_request_permanently(status: int) -> None:
    with pytest.raises(PermanentFailure):
        _provider(lambda _request: httpx.Response(status)).analyze(b"frame", {})


@pytest.mark.parametrize("status", [429, 500, 503])
def test_gemini_rate_limit_and_server_errors_are_transient(status: int) -> None:
    with pytest.raises(TransientFailure):
        _provider(lambda _request: httpx.Response(status)).analyze(b"frame", {})


def test_gemini_missing_candidate_is_transient() -> None:
    response = httpx.Response(200, json={"candidates": []})

    with pytest.raises(TransientFailure):
        _provider(lambda _request: response).analyze(b"frame", {})


def test_gemini_skips_thought_parts_and_uses_the_visible_answer() -> None:
    answer = json.dumps({"certainty": "OBSERVED", "sceneTitle": "Answer"})

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"thought": True, "text": "private reasoning"},
                                {"text": answer},
                            ]
                        }
                    }
                ]
            },
        )

    observation = _provider(handler).analyze(b"frame", {})

    assert observation["sceneTitle"] == "Answer"
