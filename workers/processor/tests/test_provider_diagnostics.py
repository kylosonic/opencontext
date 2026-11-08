"""HTTP status classification for every remote provider mode."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.providers.text.ollama import OllamaTextProvider
from oc_worker.providers.text.openai_compatible import OpenAICompatibleTextProvider
from oc_worker.providers.transcription.openai_compatible import (
    OpenAICompatibleTranscriptionProvider,
)
from oc_worker.providers.vision.ollama import OllamaVisionProvider
from oc_worker.providers.vision.openai_compatible import OpenAICompatibleVisionProvider


def _client(response: httpx.Response | Exception) -> httpx.Client:
    def handler(_request: httpx.Request) -> httpx.Response:
        if isinstance(response, Exception):
            raise response
        return response

    return httpx.Client(transport=httpx.MockTransport(handler))


def _openai_vision(client: httpx.Client) -> OpenAICompatibleVisionProvider:
    return OpenAICompatibleVisionProvider(
        base_url="http://provider.test",
        api_key="secret",
        model="vision",
        client=client,
    )


def _ollama_vision(client: httpx.Client) -> OllamaVisionProvider:
    return OllamaVisionProvider(
        base_url="http://provider.test",
        model="vision",
        client=client,
    )


def _openai_text(client: httpx.Client) -> OpenAICompatibleTextProvider:
    return OpenAICompatibleTextProvider(
        base_url="http://provider.test",
        api_key="secret",
        model="text",
        client=client,
    )


def _ollama_text(client: httpx.Client) -> OllamaTextProvider:
    return OllamaTextProvider(
        base_url="http://provider.test",
        model="text",
        client=client,
    )


def _transcription(client: httpx.Client) -> OpenAICompatibleTranscriptionProvider:
    return OpenAICompatibleTranscriptionProvider(
        base_url="http://provider.test",
        api_key="secret",
        model="whisper",
        client=client,
    )


def _invoke(provider, tmp_path: Path) -> None:
    if isinstance(provider, OpenAICompatibleTranscriptionProvider):
        audio = tmp_path / "audio.wav"
        audio.write_bytes(b"audio")
        provider.transcribe(str(audio))
    elif isinstance(
        provider, (OpenAICompatibleVisionProvider, OllamaVisionProvider)
    ):
        provider.analyze(b"frame", {"timestampSec": 0})
    else:
        provider.refine({}, "# Context\n")


@pytest.mark.parametrize(
    "factory",
    [
        _openai_vision,
        _ollama_vision,
        _openai_text,
        _ollama_text,
        _transcription,
    ],
)
@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_provider_client_errors_are_permanent(factory, status: int, tmp_path: Path) -> None:
    provider = factory(_client(httpx.Response(status)))

    with pytest.raises(PermanentFailure):
        _invoke(provider, tmp_path)


@pytest.mark.parametrize(
    "factory",
    [
        _openai_vision,
        _ollama_vision,
        _openai_text,
        _ollama_text,
        _transcription,
    ],
)
@pytest.mark.parametrize("status", [408, 409, 425, 429, 500, 503])
def test_provider_server_errors_are_transient(factory, status: int, tmp_path: Path) -> None:
    provider = factory(_client(httpx.Response(status)))

    with pytest.raises(TransientFailure):
        _invoke(provider, tmp_path)


@pytest.mark.parametrize(
    "factory",
    [_openai_vision, _ollama_vision, _openai_text, _ollama_text, _transcription],
)
def test_provider_transport_errors_are_transient(factory, tmp_path: Path) -> None:
    provider = factory(_client(httpx.ConnectError("offline")))

    with pytest.raises(TransientFailure):
        _invoke(provider, tmp_path)
