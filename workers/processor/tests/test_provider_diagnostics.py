"""HTTP status classification for every remote provider mode."""

from __future__ import annotations

import json
import wave
from pathlib import Path

import httpx
import pytest

from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.providers.text.ollama import OllamaTextProvider
from oc_worker.providers.text.openai_compatible import OpenAICompatibleTextProvider
from oc_worker.providers.transcription.openai_audio import (
    OpenAIAudioChatTranscriptionProvider,
)
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


def _openai_audio(client: httpx.Client) -> OpenAIAudioChatTranscriptionProvider:
    return OpenAIAudioChatTranscriptionProvider(
        base_url="http://provider.test",
        api_key="secret",
        model="audio-model",
        client=client,
    )


def _invoke(provider, tmp_path: Path) -> None:
    if isinstance(provider, OpenAICompatibleTranscriptionProvider):
        audio = tmp_path / "audio.wav"
        audio.write_bytes(b"audio")
        provider.transcribe(str(audio))
    elif isinstance(provider, OpenAIAudioChatTranscriptionProvider):
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
        _openai_audio,
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
        _openai_audio,
    ],
)
@pytest.mark.parametrize("status", [408, 409, 425, 429, 500, 503])
def test_provider_server_errors_are_transient(factory, status: int, tmp_path: Path) -> None:
    provider = factory(_client(httpx.Response(status)))

    with pytest.raises(TransientFailure):
        _invoke(provider, tmp_path)


@pytest.mark.parametrize(
    "factory",
    [
        _openai_vision,
        _ollama_vision,
        _openai_text,
        _ollama_text,
        _transcription,
        _openai_audio,
    ],
)
def test_provider_transport_errors_are_transient(factory, tmp_path: Path) -> None:
    provider = factory(_client(httpx.ConnectError("offline")))

    with pytest.raises(TransientFailure):
        _invoke(provider, tmp_path)


def test_opencode_headers_and_string_fields_are_normalized() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update({key.lower(): value for key, value in request.headers.items()})
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "certainty": "high",
                                    "sceneTitle": "Dashboard",
                                    "visualDescription": "A chart",
                                    "uiElements": "Export button",
                                    "visibleText": "Export",
                                    "interactions": "The user clicks Export",
                                    "layoutDescription": "Single column",
                                    "designObservations": "Rounded cards",
                                    "importantChanges": "A toast appears",
                                }
                            )
                        }
                    }
                ]
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = OpenAICompatibleVisionProvider(
        base_url="https://opencode.ai/inference/go/openai/v1",
        api_key="secret",
        model="glm-5.3-flash",
        session_id="session-123",
        client=client,
    )

    observation = provider.analyze(b"frame", {"timestampSec": 0})

    assert seen["x-opencode-session"] == "session-123"
    assert seen["user-agent"] == "opencontext-video"
    assert observation["certainty"] == "OBSERVED"
    assert observation["uiElements"] == ["Export button"]
    assert observation["visibleText"] == ["Export"]
    assert observation["interactions"] == ["The user clicks Export"]
    assert observation["designObservations"] == {"summary": "Rounded cards"}
    assert observation["importantChanges"] == ["A toast appears"]


def _write_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\0\0" * 800)


def test_openai_audio_chat_requests_wav_and_disables_reasoning(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "speech.wav"
    _write_wav(audio)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["headers"] = {
            key.lower(): value for key, value in request.headers.items()
        }
        seen["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "Hello from OpenContext."}}]},
        )

    provider = OpenAIAudioChatTranscriptionProvider(
        base_url="https://opencode.ai/inference/go/openai/v1",
        api_key="secret",
        model="mimo-audio",
        session_id="audio-session",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    segments = provider.transcribe(str(audio))

    assert seen["path"].endswith("/chat/completions")
    assert seen["headers"]["x-opencode-session"] == "audio-session"
    assert seen["payload"]["reasoning_effort"] == "none"
    user_content = seen["payload"]["messages"][1]["content"]
    assert user_content[0]["type"] == "input_audio"
    assert user_content[0]["input_audio"]["format"] == "wav"
    assert segments[0].start == 0.0
    assert segments[0].end == 0.1
    assert segments[0].text == "Hello from OpenContext."


def test_openai_audio_chat_accepts_reasoning_only_response(tmp_path: Path) -> None:
    audio = tmp_path / "speech.wav"
    _write_wav(audio)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "reasoning": "<think>Spoken words.</think>",
                        }
                    }
                ]
            },
        )

    provider = OpenAIAudioChatTranscriptionProvider(
        base_url="http://provider.test",
        api_key="secret",
        model="audio-model",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert provider.transcribe(str(audio))[0].text == "Spoken words."


def test_openai_audio_chat_omits_opencode_reasoning_for_other_endpoints(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "speech.wav"
    _write_wav(audio)
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "Generic transcript."}}]},
        )

    provider = OpenAIAudioChatTranscriptionProvider(
        base_url="http://provider.test/v1",
        api_key="secret",
        model="audio-model",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    provider.transcribe(str(audio))

    assert "reasoning_effort" not in seen["payload"]


def test_openai_audio_chat_rejects_empty_transcript(tmp_path: Path) -> None:
    audio = tmp_path / "speech.wav"
    _write_wav(audio)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "", "reasoning": ""}}]},
        )

    provider = OpenAIAudioChatTranscriptionProvider(
        base_url="http://provider.test",
        api_key="secret",
        model="audio-model",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(TransientFailure, match="empty transcript"):
        provider.transcribe(str(audio))
