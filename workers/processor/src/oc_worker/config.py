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


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _repository_env_file() -> Path | None:
    """Find the checkout's root `.env` without trusting the working directory."""
    module = Path(__file__).resolve()
    for parent in module.parents:
        marker = parent / "workers" / "processor" / "pyproject.toml"
        if marker.is_file():
            return parent / ".env"
    return None


def load_local_env(env_file: str | Path | None = None) -> None:
    """Load a trusted env file without overriding the real process environment.

    ``--env-file`` is the explicit path for installed CLI/MCP runs. When no
    path is supplied, only a repository root discovered from this module's
    location may be loaded; a `.env` in the caller's working directory is
    never consulted because executable and provider-base overrides there can
    turn an unrelated repository into code execution or credential theft.
    """
    if os.getenv("OPENCONTEXT_SKIP_DOTENV") == "1":
        return
    requested = env_file or os.getenv("OPENCONTEXT_ENV_FILE")
    candidate = Path(requested).expanduser().resolve() if requested else _repository_env_file()
    if candidate is None:
        return
    if not candidate.is_file():
        if requested:
            raise FileNotFoundError(f"env file not found: {candidate}")
        return
    load_dotenv(candidate, override=False)


def resolve_ffmpeg_path() -> str:
    """Resolve the preferred FFmpeg binary.

    The imageio wheel ships a complete build with the codecs needed to create
    fixtures. Prefer it over a host binary that may be a codec-restricted
    distribution build, then fall back to PATH for environments that install
    FFmpeg explicitly.
    """
    configured = _env("FFMPEG_PATH")
    if configured:
        return configured
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return shutil.which("ffmpeg") or "ffmpeg"


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
    worker_concurrency: int = field(
        default_factory=lambda: max(1, min(32, _env_int("WORKER_CONCURRENCY", 1)))
    )
    worker_shutdown_grace_seconds: float = field(
        default_factory=lambda: max(
            0.0, min(3600.0, _env_float("WORKER_SHUTDOWN_GRACE_SECONDS", 120.0))
        )
    )
    worker_error_backoff_seconds: float = field(
        default_factory=lambda: max(
            0.05, min(300.0, _env_float("WORKER_ERROR_BACKOFF_SECONDS", 5.0))
        )
    )
    worker_job_timeout_seconds: float = field(
        default_factory=lambda: max(
            0.05, min(86_400.0, _env_float("WORKER_JOB_TIMEOUT_SECONDS", 900.0))
        )
    )
    transcription_provider: str = field(
        default_factory=lambda: _env("TRANSCRIPTION_PROVIDER", "openai_compatible")
        or "openai_compatible"
    )
    transcription_model: str = field(
        default_factory=lambda: _env("TRANSCRIPTION_MODEL", "whisper-1") or "whisper-1"
    )
    openai_api_key: str = field(
        default_factory=lambda: _env("OPENAI_API_KEY") or _env("OPENCODE_API_KEY") or ""
    )
    openai_base_url: str = field(
        default_factory=lambda: _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
        or "https://api.openai.com/v1"
    )
    opencode_session_id: str = field(
        default_factory=lambda: _env("OPENCODE_SESSION_ID", "opencontext-local")
        or "opencontext-local"
    )
    vision_provider: str = field(
        default_factory=lambda: _env("VISION_PROVIDER", "openai_compatible") or "openai_compatible"
    )
    vision_model: str = field(
        default_factory=lambda: _env("VISION_MODEL", "gpt-4o-mini") or "gpt-4o-mini"
    )
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY") or "")
    gemini_base_url: str = field(
        default_factory=lambda: _env(
            "GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
        )
        or "https://generativelanguage.googleapis.com/v1beta"
    )
    vision_timeout_seconds: float = field(
        default_factory=lambda: max(
            1.0, min(600.0, _env_float("VISION_TIMEOUT_SECONDS", 120.0))
        )
    )
    vision_concurrency: int = field(
        default_factory=lambda: max(1, min(16, _env_int("VISION_CONCURRENCY", 2)))
    )
    vision_max_frames: int = field(
        default_factory=lambda: max(1, min(300, _env_int("VISION_MAX_FRAMES", 60)))
    )
    vision_request_interval_seconds: float = field(
        default_factory=lambda: max(
            0.0, min(300.0, _env_float("VISION_REQUEST_INTERVAL_SECONDS", 0.0))
        )
    )
    vision_fallback_models: str = field(
        default_factory=lambda: _env("VISION_FALLBACK_MODELS", "") or ""
    )
    ocr_provider: str = field(
        default_factory=lambda: _env("OCR_PROVIDER", "vision") or "vision"
    )
    ocr_language: str = field(
        default_factory=lambda: _env("OCR_LANGUAGE", "eng") or "eng"
    )
    demo_vision: bool = field(
        default_factory=lambda: _env("OPENCONTEXT_DEMO_VISION", "fixture").lower()
        == "real"
    )
    fixture_visible_text: str = field(
        default_factory=lambda: _env("FIXTURE_VISIBLE_TEXT", "OpenContext fixture frame")
        or "OpenContext fixture frame"
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
    ffmpeg_path: str = field(default_factory=resolve_ffmpeg_path)
    ffprobe_path: str = field(default_factory=lambda: _env("FFPROBE_PATH") or "")

    @classmethod
    def from_env(cls) -> Settings:
        """Build settings from the current process environment."""
        return cls()
