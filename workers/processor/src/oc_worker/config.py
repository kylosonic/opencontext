"""Environment-driven worker configuration.

Single source of truth for every tunable; mirrors `packages/config` on
the web side. Every value has a safe default so the worker starts even
with an empty environment. AI stages without credentials then fail with
actionable stage errors, per the accepted "prod has no AI credentials"
risk note in the blueprint (§8).
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


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


def load_local_env() -> None:
    """Load `.env` files for native CLI/worker runs without overriding real env."""
    if os.getenv("OPENCONTEXT_SKIP_DOTENV") == "1":
        return
    repo_root = Path(__file__).resolve().parents[4]
    for candidate in (Path.cwd() / ".env", repo_root / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False)


def _default_ffmpeg_path() -> str:
    configured = _env("FFMPEG_PATH")
    if configured:
        return configured
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return "ffmpeg"


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
    ocr_provider: str = field(
        default_factory=lambda: _env("OCR_PROVIDER", "vision") or "vision"
    )
    ocr_language: str = field(
        default_factory=lambda: _env("OCR_LANGUAGE", "eng") or "eng"
    )
    tesseract_path: str = field(
        default_factory=lambda: _env("TESSERACT_PATH", "tesseract") or "tesseract"
    )
    ollama_base_url: str = field(
        default_factory=lambda: _env("OLLAMA_BASE_URL", "http://localhost:11434")
        or "http://localhost:11434"
    )
    text_provider: str = field(default_factory=lambda: _env("TEXT_PROVIDER") or "")
    text_model: str = field(
        default_factory=lambda: _env("TEXT_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    )
    ffmpeg_path: str = field(default_factory=_default_ffmpeg_path)
    ffprobe_path: str = field(default_factory=lambda: _env("FFPROBE_PATH") or "")

    @classmethod
    def from_env(cls) -> Settings:
        """Build settings from the current process environment."""
        return cls()
