"""Environment and provider readiness checks for ``opencontext doctor``."""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Callable
from importlib.util import find_spec
from pathlib import Path

import httpx

from oc_worker.config import Settings


def _command_status(label: str, command: str, *, required: bool) -> dict[str, str]:
    resolved = shutil.which(command)
    if not resolved:
        return {
            "name": label,
            "status": "missing" if required else "unverified",
            "detail": f"{command} was not found on PATH",
        }
    try:
        subprocess.run(
            [resolved, "-version"],
            capture_output=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "name": label,
            "status": "missing" if required else "unverified",
            "detail": f"{command} could not be executed: {exc}",
        }
    return {"name": label, "status": "ok", "detail": resolved}


def _configured(value: str) -> bool:
    return bool(value and value != "change-me")


def _remote_status(
    name: str,
    url: str,
    *,
    headers: dict[str, str] | None,
    detail: str,
    http_get: Callable[..., httpx.Response] = httpx.get,
) -> dict[str, str]:
    try:
        response = http_get(url, headers=headers or {}, timeout=3.0)
    except httpx.HTTPError as exc:
        return {
            "name": name,
            "status": "missing",
            "detail": f"{detail}; request failed: {exc}",
        }
    if response.status_code >= 400:
        return {
            "name": name,
            "status": "missing",
            "detail": f"{detail}; endpoint returned HTTP {response.status_code}",
        }
    return {"name": name, "status": "ok", "detail": detail}


def _provider_checks(
    settings: Settings,
    *,
    offline: bool,
    check_network: bool,
    http_get: Callable[..., httpx.Response] = httpx.get,
) -> list[dict[str, str]]:
    """Inspect transcription, vision, OCR, and text provider readiness."""
    checks: list[dict[str, str]] = []
    transcription = settings.transcription_provider.lower()
    if transcription in ("", "none", "off"):
        checks.append(
            {
                "name": "transcription",
                "status": "ok",
                "detail": "transcription provider explicitly disabled",
            }
        )
    elif transcription == "fixture":
        checks.append(
            {
                "name": "transcription",
                "status": "ok",
                "detail": "fixture provider (no speech model)",
            }
        )
    elif transcription == "faster_whisper":
        available = find_spec("faster_whisper") is not None
        checks.append(
            {
                "name": "transcription",
                "status": "ok" if available else "missing",
                "detail": (
                    f"faster-whisper installed; model={settings.transcription_model}"
                    if available
                    else "faster-whisper is not installed; install the [local] extra"
                ),
            }
        )
    elif transcription == "openai_compatible":
        configured = _configured(settings.openai_api_key)
        checks.append(
            {
                "name": "transcription",
                "status": "ok" if configured else "missing",
                "detail": (
                    f"OpenAI-compatible endpoint configured; model={settings.transcription_model}"
                    if configured
                    else "OPENAI_API_KEY is not set"
                ),
            }
        )
    elif transcription == "openai_audio":
        configured = _configured(settings.openai_api_key)
        checks.append(
            {
                "name": "transcription",
                "status": "ok" if configured else "missing",
                "detail": (
                    f"OpenAI-compatible audio chat endpoint configured; "
                    f"model={settings.transcription_model}"
                    if configured
                    else "OPENAI_API_KEY is not set"
                ),
            }
        )
    else:
        checks.append(
            {
                "name": "transcription",
                "status": "missing",
                "detail": (
                    f"unknown TRANSCRIPTION_PROVIDER={settings.transcription_provider!r}; "
                    "expected fixture, faster_whisper, openai_compatible, "
                    "openai_audio, none, or off"
                ),
            }
        )

    vision = settings.vision_provider.lower()
    if vision in ("", "none", "off"):
        checks.append(
            {
                "name": "vision",
                "status": "ok",
                "detail": "vision provider explicitly disabled",
            }
        )
    elif vision == "fixture":
        checks.append(
            {
                "name": "vision",
                "status": "ok",
                "detail": "fixture provider (no vision model)",
            }
        )
    elif vision == "ollama":
        detail = f"Ollama configured at {settings.ollama_base_url}; model={settings.vision_model}"
        if check_network and not offline:
            checks.append(
                _remote_status(
                    "vision",
                    f"{settings.ollama_base_url.rstrip('/')}/api/tags",
                    headers=None,
                    detail=detail,
                    http_get=http_get,
                )
            )
        else:
            checks.append({"name": "vision", "status": "unverified", "detail": detail})
    elif vision == "gemini":
        configured = _configured(settings.gemini_api_key)
        detail = (
            f"Gemini Generative Language API configured at {settings.gemini_base_url}; "
            f"model={settings.vision_model}"
        )
        if not configured:
            checks.append(
                {
                    "name": "vision",
                    "status": "missing",
                    "detail": "GEMINI_API_KEY is not set",
                }
            )
        elif check_network and not offline:
            checks.append(
                _remote_status(
                    "vision",
                    f"{settings.gemini_base_url.rstrip('/')}/models?pageSize=1",
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    detail=detail,
                    http_get=http_get,
                )
            )
        else:
            checks.append({"name": "vision", "status": "ok", "detail": detail})
    elif vision == "openai_compatible":
        configured = _configured(settings.openai_api_key)
        if not configured:
            checks.append(
                {
                    "name": "vision",
                    "status": "missing",
                    "detail": "OPENAI_API_KEY is not set",
                }
            )
        elif check_network and not offline:
            checks.append(
                _remote_status(
                    "vision",
                    f"{settings.openai_base_url.rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    detail=f"OpenAI-compatible endpoint configured; model={settings.vision_model}",
                    http_get=http_get,
                )
            )
        else:
            checks.append(
                {
                    "name": "vision",
                    "status": "ok",
                    "detail": (
                        "OpenAI-compatible endpoint configured; "
                        f"model={settings.vision_model}"
                    ),
                }
            )
    else:
        checks.append(
            {
                "name": "vision",
                "status": "missing",
                "detail": (
                    f"unknown VISION_PROVIDER={settings.vision_provider!r}; "
                    "expected fixture, gemini, ollama, openai_compatible, none, or off"
                ),
            }
        )

    ocr = settings.ocr_provider.lower()
    if ocr in ("", "none", "off"):
        checks.append(
            {
                "name": "ocr",
                "status": "ok",
                "detail": "independent OCR provider disabled",
            }
        )
    elif ocr == "vision":
        checks.append(
            {
                "name": "ocr",
                "status": "ok",
                "detail": "vision-derived OCR compatibility mode",
            }
        )
    elif ocr == "fixture":
        checks.append(
            {"name": "ocr", "status": "ok", "detail": "fixture OCR provider"}
        )
    elif ocr == "tesseract":
        check = _command_status("ocr", settings.tesseract_path, required=True)
        check["detail"] += f"; language={settings.ocr_language}"
        checks.append(check)
    else:
        checks.append(
            {
                "name": "ocr",
                "status": "missing",
                "detail": (
                    f"unknown OCR_PROVIDER={settings.ocr_provider!r}; "
                    "expected vision, fixture, tesseract, none, or off"
                ),
            }
        )

    text = settings.text_provider.lower()
    if text in ("", "template", "none", "off"):
        checks.append(
            {"name": "text", "status": "ok", "detail": "deterministic template provider"}
        )
    elif text == "ollama":
        detail = f"Ollama configured at {settings.ollama_base_url}; model={settings.text_model}"
        if check_network and not offline:
            checks.append(
                _remote_status(
                    "text",
                    f"{settings.ollama_base_url.rstrip('/')}/api/tags",
                    headers=None,
                    detail=detail,
                    http_get=http_get,
                )
            )
        else:
            checks.append({"name": "text", "status": "unverified", "detail": detail})
    elif text == "openai_compatible":
        configured = _configured(settings.openai_api_key)
        checks.append(
            {
                "name": "text",
                "status": "ok" if configured else "missing",
                "detail": (
                    f"OpenAI-compatible endpoint configured; model={settings.text_model}"
                    if configured
                    else "OPENAI_API_KEY is not set"
                ),
            }
        )
    else:
        checks.append(
            {
                "name": "text",
                "status": "missing",
                "detail": (
                    f"unknown TEXT_PROVIDER={settings.text_provider!r}; "
                    "expected template, ollama, openai_compatible, none, or off"
                ),
            }
        )
    return checks


def run_doctor(
    settings: Settings,
    *,
    offline: bool = False,
    check_network: bool = False,
    json_output: bool = False,
    http_get: Callable[..., httpx.Response] = httpx.get,
) -> int:
    """Print dependency readiness without exposing credentials."""
    checks = [_command_status("ffmpeg", settings.ffmpeg_path, required=True)]
    ffprobe = settings.ffprobe_path
    if not ffprobe:
        ffmpeg_path = shutil.which(settings.ffmpeg_path)
        ffprobe = (
            str(Path(ffmpeg_path).with_name("ffprobe"))
            if ffmpeg_path and Path(ffmpeg_path).parent != Path(".")
            else "ffprobe"
        )
    checks.append(_command_status("ffprobe", ffprobe, required=False))
    checks.extend(
        _provider_checks(
            settings,
            offline=offline,
            check_network=check_network,
            http_get=http_get,
        )
    )
    ok = not any(check["status"] == "missing" for check in checks)
    if json_output:
        print(json.dumps({"ok": ok, "checks": checks}, sort_keys=True))
    else:
        for check in checks:
            print(f"{check['status'].upper():10} {check['name']}: {check['detail']}")
    return 0 if ok else 1
