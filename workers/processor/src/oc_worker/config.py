"""Environment-driven worker configuration.

Single source of truth for every tunable; mirrors `packages/config` on
the web side. Every value has a safe default so the worker starts even
with an empty environment. AI stages without credentials then fail with
actionable stage errors, per the accepted "prod has no AI credentials"
risk note in the blueprint (§8).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """All worker settings, each overridable via environment variable."""

    worker_api_url: str = field(
        default_factory=lambda: _env("WORKER_API_URL", "http://localhost:3000")
        or "http://localhost:3000"
    )
    worker_api_token: str = field(default_factory=lambda: _env("WORKER_API_TOKEN") or "")
    worker_id: str = field(
        default_factory=lambda: _env("WORKER_ID", "oc-worker-1") or "oc-worker-1"
    )
    worker_concurrency: int = field(default_factory=lambda: _env_int("WORKER_CONCURRENCY", 1))
    transcription_provider: str = field(
        default_factory=lambda: _env("TRANSCRIPTION_PROVIDER", "openai_compatible")
        or "openai_compatible"
    )
    transcription_model: str = field(
        default_factory=lambda: _env("TRANSCRIPTION_MODEL", "whisper-1") or "whisper-1"
    )
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY") or "")
    openai_base_url: str = field(
        default_factory=lambda: _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
        or "https://api.openai.com/v1"
    )
    vision_provider: str = field(
        default_factory=lambda: _env("VISION_PROVIDER", "openai_compatible") or "openai_compatible"
    )
    vision_model: str = field(
        default_factory=lambda: _env("VISION_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    )
    ollama_base_url: str = field(
        default_factory=lambda: _env("OLLAMA_BASE_URL", "http://localhost:11434")
        or "http://localhost:11434"
    )
    text_provider: str = field(default_factory=lambda: _env("TEXT_PROVIDER") or "")
    text_model: str = field(
        default_factory=lambda: _env("TEXT_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    )
    ffmpeg_path: str = field(default_factory=lambda: _env("FFMPEG_PATH", "ffmpeg") or "ffmpeg")
    ffprobe_path: str = field(default_factory=lambda: _env("FFPROBE_PATH") or "")

    @classmethod
    def from_env(cls) -> Settings:
        """Build settings from the current process environment."""
        return cls()
