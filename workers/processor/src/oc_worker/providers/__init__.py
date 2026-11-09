"""Provider factories for transcription, vision and text stages."""

from __future__ import annotations

from oc_worker.config import Settings
from oc_worker.errors import ProviderConfigurationError
from oc_worker.providers.ocr.base import OcrProvider
from oc_worker.providers.ocr.fixture import FixtureOcrProvider
from oc_worker.providers.ocr.tesseract import TesseractOcrProvider
from oc_worker.providers.text.base import TextProvider
from oc_worker.providers.text.ollama import OllamaTextProvider
from oc_worker.providers.text.openai_compatible import OpenAICompatibleTextProvider
from oc_worker.providers.text.template import TemplateTextProvider
from oc_worker.providers.transcription.base import TranscriptionProvider
from oc_worker.providers.transcription.fixture import FixtureTranscriptionProvider
from oc_worker.providers.transcription.openai_audio import (
    OpenAIAudioChatTranscriptionProvider,
)
from oc_worker.providers.transcription.openai_compatible import (
    OpenAICompatibleTranscriptionProvider,
)
from oc_worker.providers.vision.base import VisionProvider
from oc_worker.providers.vision.fixture import FixtureVisionProvider
from oc_worker.providers.vision.ollama import OllamaVisionProvider
from oc_worker.providers.vision.openai_compatible import OpenAICompatibleVisionProvider


def build_transcription(settings: Settings) -> TranscriptionProvider | None:
    """Build the transcription provider; None when none is configured."""
    provider = settings.transcription_provider.lower()
    if provider in ("", "none", "off"):
        return None
    if provider == "fixture":
        return FixtureTranscriptionProvider()
    if provider == "faster_whisper":
        from oc_worker.providers.transcription.faster_whisper import (
            FasterWhisperTranscriptionProvider,
        )

        return FasterWhisperTranscriptionProvider(settings.transcription_model)
    if provider == "openai_compatible":
        if not settings.openai_api_key:
            raise ProviderConfigurationError(
                "OPENAI_API_KEY is required when "
                "TRANSCRIPTION_PROVIDER=openai_compatible"
            )
        return OpenAICompatibleTranscriptionProvider(
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
            model=settings.transcription_model,
            session_id=settings.opencode_session_id,
        )
    if provider == "openai_audio":
        if not settings.openai_api_key:
            raise ProviderConfigurationError(
                "OPENAI_API_KEY is required when TRANSCRIPTION_PROVIDER=openai_audio"
            )
        return OpenAIAudioChatTranscriptionProvider(
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
            model=settings.transcription_model,
            session_id=settings.opencode_session_id,
        )
    raise ProviderConfigurationError(
        f"Unknown TRANSCRIPTION_PROVIDER={settings.transcription_provider!r}; "
        "expected fixture, faster_whisper, openai_compatible, openai_audio, none, or off"
    )


def build_vision(settings: Settings) -> VisionProvider | None:
    """Build the vision provider; None when none is configured."""
    provider = settings.vision_provider.lower()
    if provider in ("", "none", "off"):
        return None
    if provider == "fixture":
        return FixtureVisionProvider()
    if provider == "ollama":
        return OllamaVisionProvider(
            base_url=settings.ollama_base_url,
            model=settings.vision_model,
            session_id=settings.opencode_session_id,
        )
    if provider == "openai_compatible":
        if not settings.openai_api_key:
            raise ProviderConfigurationError(
                "OPENAI_API_KEY is required when VISION_PROVIDER=openai_compatible"
            )
        return OpenAICompatibleVisionProvider(
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
            model=settings.vision_model,
            session_id=settings.opencode_session_id,
        )
    raise ProviderConfigurationError(
        f"Unknown VISION_PROVIDER={settings.vision_provider!r}; "
        "expected fixture, ollama, openai_compatible, none, or off"
    )


def build_ocr(settings: Settings) -> OcrProvider | None:
    """Build an independent OCR provider; None keeps vision-derived OCR."""
    provider = settings.ocr_provider.lower()
    if provider in ("", "none", "vision"):
        return None
    if provider == "fixture":
        return FixtureOcrProvider()
    if provider == "tesseract":
        return TesseractOcrProvider(
            executable=settings.tesseract_path,
            language=settings.ocr_language,
        )
    raise ProviderConfigurationError(
        f"Unknown OCR_PROVIDER={settings.ocr_provider!r}; "
        "expected vision, fixture, tesseract, none, or off"
    )


def build_text(settings: Settings) -> TextProvider:
    """Build the text provider; template (deterministic) fallback otherwise."""
    provider = settings.text_provider.lower()
    if provider in ("", "template"):
        return TemplateTextProvider()
    if provider == "ollama":
        return OllamaTextProvider(
            base_url=settings.ollama_base_url,
            model=settings.text_model,
            session_id=settings.opencode_session_id,
        )
    if provider == "openai_compatible":
        if not settings.openai_api_key:
            raise ProviderConfigurationError(
                "OPENAI_API_KEY is required when TEXT_PROVIDER=openai_compatible"
            )
        return OpenAICompatibleTextProvider(
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
            model=settings.text_model,
            session_id=settings.opencode_session_id,
        )
    raise ProviderConfigurationError(
        f"Unknown TEXT_PROVIDER={settings.text_provider!r}; "
        "expected template, ollama, openai_compatible, none, or off"
    )
