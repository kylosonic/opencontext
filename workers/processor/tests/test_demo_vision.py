"""Real-vision demo configuration and startup validation without network calls."""

from __future__ import annotations

from pathlib import Path

import pytest

from oc_worker.config import Settings
from oc_worker.errors import ProviderConfigurationError
from oc_worker.main import _check_demo_vision, _demo_vision_summary
from oc_worker.providers import build_vision
from oc_worker.providers.vision.demo import validate_demo_vision
from oc_worker.providers.vision.fixture import FixtureVisionProvider
from oc_worker.providers.vision.gemini import GeminiVisionProvider
from oc_worker.providers.vision.openai_compatible import OpenAICompatibleVisionProvider

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE = REPO_ROOT / "docs/assets/real-vision-checkout.png"
FIXTURE_REFERENCE = REPO_ROOT / "scripts/generate-fixture.mjs"
LAUNCHER = REPO_ROOT / "scripts/real-vision-demo.mjs"


def test_fixture_remains_default_and_reference_is_static() -> None:
    settings = Settings(
        demo_vision=False,
        vision_provider="fixture",
    )

    provider = build_vision(settings)

    assert isinstance(provider, FixtureVisionProvider)
    assert REFERENCE.is_file(), "the attributed synthetic demo reference is missing"
    assert "opencontext-fixture.png" in FIXTURE_REFERENCE.read_text(encoding="utf-8")
    assert "OPENCONTEXT_DEMO_MODEL" in LAUNCHER.read_text(encoding="utf-8")


def test_real_mode_builds_openai_compatible_vision_from_settings() -> None:
    settings = Settings(
        demo_vision=True,
        vision_provider="openai_compatible",
        vision_model="image-capable-model",
        openai_api_key="not-a-real-key",
        openai_base_url="https://provider.example/v1",
    )
    _check_demo_vision(settings)

    provider = build_vision(settings)

    assert isinstance(provider, OpenAICompatibleVisionProvider)
    assert provider.model == "image-capable-model"


def test_incomplete_real_mode_fails_before_provider_request() -> None:
    settings = Settings(
        demo_vision=True,
        vision_provider="openai_compatible",
        vision_model="",
        openai_api_key="not-a-real-key",
        openai_base_url="https://provider.example/v1",
    )

    with pytest.raises(ProviderConfigurationError, match="VISION_MODEL") as exc_info:
        validate_demo_vision(settings)

    assert "not-a-real-key" not in str(exc_info.value)


def test_real_mode_builds_gemini_vision_from_settings() -> None:
    settings = Settings(
        demo_vision=True,
        vision_provider="gemini",
        vision_model="gemini-test-model",
        gemini_api_key="not-a-real-key",
        vision_timeout_seconds=180,
        transcription_provider="none",
    )
    _check_demo_vision(settings)

    provider = build_vision(settings)

    assert isinstance(provider, GeminiVisionProvider)
    assert provider.model == "gemini-test-model"
    assert "gemini-4-hydrogen" in LAUNCHER.read_text(encoding="utf-8")
    assert "OPENCONTEXT_DEMO_OPENAI_BASE_URL" in LAUNCHER.read_text(encoding="utf-8")


def test_gemini_demo_summary_reports_the_gemini_endpoint() -> None:
    settings = Settings(
        demo_vision=True,
        vision_provider="gemini",
        vision_model="gemini-test-model",
        gemini_api_key="not-a-real-key",
        gemini_base_url="https://gemini.example/v1beta",
        openai_base_url="https://wrong.example/v1",
    )

    assert _demo_vision_summary(settings) == {
        "mode": "real",
        "visionProvider": "gemini",
        "baseUrl": "https://gemini.example/v1beta",
        "visionModel": "gemini-test-model",
    }


def test_openai_key_alone_does_not_enable_local_real_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENCONTEXT_SKIP_DOTENV", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key")
    monkeypatch.delenv("OPENCONTEXT_DEMO_VISION", raising=False)
    monkeypatch.delenv("VISION_PROVIDER", raising=False)

    settings = Settings.from_env()

    assert not settings.demo_vision
