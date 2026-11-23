"""HTTP status classification for every remote provider mode."""

from __future__ import annotations

import json
import time
import wave
from pathlib import Path

import httpx
import pytest

from oc_worker.errors import (
    JobAbort,
    PermanentFailure,
    ProcessingCancelled,
    TransientFailure,
    bind_abort,
)
from oc_worker.providers.http_status import (
    openai_compatible_headers,
    provider_session,
)
from oc_worker.providers.text.ollama import OllamaTextProvider
from oc_worker.providers.text.openai_compatible import OpenAICompatibleTextProvider
from oc_worker.providers.transcription.audio_chunks import bounded_audio_chunks
from oc_worker.providers.transcription.openai_audio import (
    OpenAIAudioChatTranscriptionProvider,
)
from oc_worker.providers.transcription.openai_compatible import (
    OpenAICompatibleTranscriptionProvider,
)
from oc_worker.providers.vision.ollama import OllamaVisionProvider
from oc_worker.providers.vision.openai_compatible import OpenAICompatibleVisionProvider


def test_provider_session_overrides_shared_opencode_session_header() -> None:
    base_url = "https://opencode.ai/inference/go/openai/v1"
    assert (
        openai_compatible_headers("secret", base_url, "shared-local")[
            "x-opencode-session"
        ]
        == "shared-local"
    )
    with provider_session("opencontext-job-42"):
        assert (
            openai_compatible_headers("secret", base_url, "shared-local")[
                "x-opencode-session"
            ]
            == "opencontext-job-42"
        )


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


def test_provider_429_preserves_bounded_retry_after() -> None:
    provider = _openai_vision(
        _client(httpx.Response(429, headers={"Retry-After": "15"}))
    )

    with pytest.raises(TransientFailure) as exc_info:
        provider.analyze(b"frame", {"timestampSec": 0})

    assert exc_info.value.retry_after_seconds == 15.0


def test_provider_429_caps_a_long_retry_after_at_fifteen_minutes() -> None:
    provider = _openai_vision(
        _client(httpx.Response(429, headers={"Retry-After": "3600"}))
    )

    with pytest.raises(TransientFailure) as exc_info:
        provider.analyze(b"frame", {"timestampSec": 0})

    assert exc_info.value.retry_after_seconds == 900.0


def test_provider_429_without_retry_after_uses_a_conservative_cooldown() -> None:
    provider = _openai_vision(_client(httpx.Response(429)))

    with pytest.raises(TransientFailure) as exc_info:
        provider.analyze(b"frame", {"timestampSec": 0})

    assert exc_info.value.rate_limited is True
    assert exc_info.value.retry_after_seconds == 60.0


def test_opencode_vision_uses_a_fallback_model_after_429() -> None:
    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        models.append(model)
        if model == "primary-free":
            return httpx.Response(429)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"sceneTitle": "Fallback"})}}]},
        )

    provider = OpenAICompatibleVisionProvider(
        base_url="https://opencode.ai/inference/go/openai/v1",
        api_key="secret",
        model="primary-free",
        fallback_models=("backup-model",),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    observation = provider.analyze(b"frame", {"timestampSec": 0})

    assert models == ["primary-free", "backup-model"]
    assert observation["sceneTitle"] == "Fallback"
    assert observation["model"] == "backup-model"


def test_rate_limited_primary_is_skipped_for_later_frames() -> None:
    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        model = json.loads(request.content)["model"]
        models.append(model)
        if model == "primary-free":
            return httpx.Response(429)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"sceneTitle": "Fallback"})}}]},
        )

    provider = OpenAICompatibleVisionProvider(
        base_url="https://opencode.ai/inference/go/openai/v1",
        api_key="secret",
        model="primary-free",
        fallback_models=("backup-model",),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    provider.analyze(b"frame-one", {"timestampSec": 0})
    provider.analyze(b"frame-two", {"timestampSec": 1})

    assert models == ["primary-free", "backup-model", "backup-model"]


def test_rate_limit_cooldown_is_scoped_to_models_not_global_pacing() -> None:
    provider = OpenAICompatibleVisionProvider(
        base_url="https://provider.example/v1",
        api_key="secret",
        model="only-model",
        min_request_interval_seconds=0.01,
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    429, headers={"Retry-After": "900"}
                )
            )
        ),
    )

    with pytest.raises(TransientFailure):
        provider.analyze(b"frame", {"timestampSec": 0})

    with provider._request_lock:
        assert provider._next_request_at < time.monotonic() + 1
        assert provider._model_unavailable_until["only-model"] > time.monotonic() + 800


def test_vision_provider_rejects_an_empty_model_list() -> None:
    with pytest.raises(ValueError, match="at least one model"):
        OpenAICompatibleVisionProvider(
            base_url="https://provider.example/v1",
            api_key="secret",
            model="   ",
            fallback_models=(),
            client=httpx.Client(),
        )


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


def test_opencode_job_session_overrides_the_shared_default() -> None:
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
                                {"sceneTitle": "Independent job"}
                            )
                        }
                    }
                ]
            },
        )

    provider = OpenAICompatibleVisionProvider(
        base_url="https://opencode.ai/inference/go/openai/v1",
        api_key="secret",
        model="glm-5.3-flash",
        session_id="shared-worker-default",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    provider.analyze(b"frame", {"sessionId": "opencontext-job-123"})

    assert seen["x-opencode-session"] == "opencontext-job-123"


def _write_wav(path: Path) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\0\0" * 800)


def test_long_wav_is_split_below_the_provider_limit(tmp_path: Path) -> None:
    audio = tmp_path / "speech.wav"
    with wave.open(str(audio), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\0\0" * 8_000)

    with bounded_audio_chunks(audio, max_bytes=4096) as chunks:
        assert len(chunks) > 1
        assert all(chunk.path.stat().st_size <= 4096 for chunk in chunks)
        assert chunks[0].offset_seconds == 0.0
        assert all(
            later.offset_seconds > earlier.offset_seconds
            for earlier, later in zip(chunks[:-1], chunks[1:], strict=True)
        )

        requests: list[int] = []

        def handler(_request: httpx.Request) -> httpx.Response:
            requests.append(1)
            return httpx.Response(
                200,
                json={"segments": [{"start": 0, "end": 0.05, "text": "chunk"}]},
            )

        provider = OpenAICompatibleTranscriptionProvider(
            base_url="http://provider.test/v1",
            api_key="secret",
            model="whisper-test",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
            max_request_bytes=4096,
        )
        segments = provider.transcribe(str(audio))

    assert len(requests) == len(chunks)
    assert [segment.start for segment in segments] == [chunk.offset_seconds for chunk in chunks]


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


def test_openai_audio_chat_never_uses_chain_of_thought_as_transcript(tmp_path: Path) -> None:
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

    assert provider.transcribe(str(audio)) == []


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


def test_openai_audio_chat_treats_silence_as_an_empty_transcript(tmp_path: Path) -> None:
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

    assert provider.transcribe(str(audio)) == []


def test_openai_audio_chat_splits_provider_text_to_schema_limits(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "speech.wav"
    _write_wav(audio)
    transcript = "word " * 10_000

    provider = OpenAIAudioChatTranscriptionProvider(
        base_url="http://provider.test/v1",
        api_key="secret",
        model="audio-model",
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": transcript}}]},
                )
            )
        ),
    )

    segments = provider.transcribe(str(audio))

    assert len(segments) > 1
    assert all(len(segment.text) <= 20_000 for segment in segments)
    assert segments[0].start == 0.0
    assert segments[-1].end == 0.1
    assert all(
        later.start >= earlier.start
        for earlier, later in zip(segments, segments[1:], strict=False)
    )
    assert " ".join(segment.text for segment in segments) == transcript.strip()


def test_openai_audio_chat_honors_abort_before_next_chunk(tmp_path: Path) -> None:
    audio = tmp_path / "speech.wav"
    _write_wav(audio)
    requests: list[httpx.Request] = []
    abort = JobAbort("test cancellation")
    previous = bind_abort(abort)
    abort.abort()
    try:
        provider = OpenAIAudioChatTranscriptionProvider(
            base_url="http://provider.test/v1",
            api_key="secret",
            model="audio-model",
            client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda request: (
                        requests.append(request)
                        or httpx.Response(
                            200,
                            json={"choices": [{"message": {"content": "unused"}}]},
                        )
                    )
                )
            ),
        )

        with pytest.raises(ProcessingCancelled):
            provider.transcribe(str(audio))
    finally:
        bind_abort(previous)

    assert requests == []
