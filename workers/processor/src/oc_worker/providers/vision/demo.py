"""Guard the opt-in real-vision path used by the local Compose demo."""

from __future__ import annotations

from oc_worker.config import Settings
from oc_worker.errors import ProviderConfigurationError


def validate_demo_vision(settings: Settings) -> None:
    """Reject ambiguous or incomplete local real-vision settings safely."""
    provider = settings.vision_provider.strip().lower()
    if not provider:
        raise ProviderConfigurationError("OPENCONTEXT_DEMO_VISION=real requires VISION_PROVIDER")
    if provider != "openai_compatible":
        raise ProviderConfigurationError(
            "OPENCONTEXT_DEMO_VISION=real requires VISION_PROVIDER=openai_compatible"
        )
    if not settings.openai_api_key.strip():
        raise ProviderConfigurationError(
            "OPENAI_API_KEY or OPENCODE_API_KEY is required when "
            "VISION_PROVIDER=openai_compatible"
        )
    if not settings.openai_base_url.strip():
        raise ProviderConfigurationError(
            "OPENAI_BASE_URL is required when VISION_PROVIDER=openai_compatible"
        )
    if not settings.vision_model.strip():
        raise ProviderConfigurationError(
            "VISION_MODEL is required when VISION_PROVIDER=openai_compatible"
        )
