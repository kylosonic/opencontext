"""Opt-in real audio transcription smoke test through OpenCode Go."""

from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest

from oc_worker.providers.transcription.openai_audio import (
    OpenAIAudioChatTranscriptionProvider,
)

ENABLED = os.getenv("OPENCONTEXT_OPENCODE_AUDIO_E2E") == "1"
AUDIO = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "evaluation"
    / "harvard-osr-us-10.wav"
)

pytestmark = pytest.mark.skipif(
    not ENABLED,
    reason="set OPENCONTEXT_OPENCODE_AUDIO_E2E=1 to run",
)


def test_real_opencode_audio_transcription() -> None:
    api_key = os.getenv("OPENCODE_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        pytest.fail(
            "OPENCODE_API_KEY is required. Set it to a valid OpenCode Go API key.",
            pytrace=False,
        )
    base_url = os.getenv(
        "OPENAI_BASE_URL",
        "https://opencode.ai/inference/go/openai/v1",
    ).rstrip("/")
    model = os.getenv("TRANSCRIPTION_MODEL", "mimo-v2.6-pro")
    session_id = os.getenv(
        "OPENCODE_SESSION_ID",
        "opencontext-hearing-smoke",
    )

    try:
        response = httpx.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15.0,
        )
        response.raise_for_status()
        models = {
            str(item.get("id")): item for item in response.json().get("data", [])
        }
    except (httpx.HTTPError, ValueError) as exc:
        pytest.fail(f"OpenCode Go models endpoint is unavailable: {exc}", pytrace=False)

    selected = models.get(model)
    if selected is None:
        pytest.fail(
            f"OpenCode Go model {model!r} is unavailable; set TRANSCRIPTION_MODEL "
            "to an audio-capable model.",
            pytrace=False,
        )
    audio_inputs = (selected.get("modalities") or {}).get("input") or []
    if not any(str(item).startswith("audio/") for item in audio_inputs):
        pytest.fail(f"OpenCode Go model {model!r} does not accept audio input", pytrace=False)

    provider = OpenAIAudioChatTranscriptionProvider(
        base_url=base_url,
        api_key=api_key,
        model=model,
        session_id=session_id,
    )
    segments = provider.transcribe(str(AUDIO))

    assert segments
    assert segments[0].start == 0
    assert segments[0].end > 30
    assert "birch canoe" in segments[0].text.casefold()
