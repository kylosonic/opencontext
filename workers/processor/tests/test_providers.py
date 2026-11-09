"""Provider factory validation without network calls."""

from __future__ import annotations

import pytest

from oc_worker.config import Settings
from oc_worker.errors import ProviderConfigurationError
from oc_worker.providers import (
    build_ocr,
    build_text,
    build_transcription,
    build_vision,
)
from oc_worker.providers.transcription.openai_audio import (
    OpenAIAudioChatTranscriptionProvider,
)


@pytest.mark.parametrize("provider", ["", "none", "off"])
def test_transcription_and_vision_opt_outs_return_none(provider: str) -> None:
    settings = Settings(transcription_provider=provider, vision_provider=provider)

    assert build_transcription(settings) is None
    assert build_vision(settings) is None


def test_unknown_transcription_provider_names_setting() -> None:
    settings = Settings(transcription_provider="mystery")

    with pytest.raises(ProviderConfigurationError, match="TRANSCRIPTION_PROVIDER"):
        build_transcription(settings)


def test_unknown_vision_provider_names_setting() -> None:
    settings = Settings(vision_provider="mystery")

    with pytest.raises(ProviderConfigurationError, match="VISION_PROVIDER"):
        build_vision(settings)


def test_unknown_ocr_and_text_providers_name_settings() -> None:
    with pytest.raises(ProviderConfigurationError, match="OCR_PROVIDER"):
        build_ocr(Settings(ocr_provider="mystery"))
    with pytest.raises(ProviderConfigurationError, match="TEXT_PROVIDER"):
        build_text(Settings(text_provider="mystery"))


@pytest.mark.parametrize(
    ("builder", "setting"),
    [
        (build_transcription, "TRANSCRIPTION_PROVIDER"),
        (build_vision, "VISION_PROVIDER"),
        (build_text, "TEXT_PROVIDER"),
    ],
)
def test_openai_compatible_provider_requires_api_key(builder, setting: str) -> None:
    settings = Settings(
        transcription_provider="openai_compatible",
        vision_provider="openai_compatible",
        text_provider="openai_compatible",
        openai_api_key="",
    )

    with pytest.raises(ProviderConfigurationError, match=setting) as exc_info:
        builder(settings)

    assert "OPENAI_API_KEY" in str(exc_info.value)


def test_provider_error_does_not_include_secret_values() -> None:
    secret = "sk-never-print-this-value"
    settings = Settings(
        transcription_provider="openai_compatible",
        vision_provider="openai_compatible",
        text_provider="openai_compatible",
        openai_api_key=secret,
    )

    with pytest.raises(ProviderConfigurationError, match="VISION_PROVIDER") as exc_info:
        build_vision(Settings(vision_provider="mystery", openai_api_key=secret))

    assert secret not in str(exc_info.value)
    assert build_transcription(settings) is not None
    assert build_vision(settings) is not None
    assert build_text(settings) is not None


def test_openai_audio_builder_uses_chat_provider() -> None:
    settings = Settings(
        transcription_provider="openai_audio",
        transcription_model="mimo-v2.6-pro",
        openai_api_key="opencode-test-key",
        openai_base_url="https://opencode.ai/inference/go/openai/v1",
    )

    provider = build_transcription(settings)

    assert isinstance(provider, OpenAIAudioChatTranscriptionProvider)
    assert provider.model == "mimo-v2.6-pro"
