"""Transcribe WAV audio with an audio-capable OpenAI-compatible chat model."""

from __future__ import annotations

import base64
import wave
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from oc_worker.errors import TransientFailure
from oc_worker.models import Segment
from oc_worker.providers.http_status import (
    openai_compatible_headers,
    raise_for_provider_status,
)
from oc_worker.providers.transcription.audio_chunks import bounded_audio_chunks

_SYSTEM_PROMPT = (
    "Transcribe the spoken audio exactly. Return only the transcript text. "
    "Preserve names, numbers, and sentence punctuation. Do not explain your work."
)


def _audio_duration(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as source:
            frame_rate = source.getframerate()
            return (
                round(source.getnframes() / frame_rate, 3)
                if frame_rate > 0
                else 0.0
            )
    except (OSError, EOFError, wave.Error):
        return 0.0


def _message_text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    return ""


class OpenAIAudioChatTranscriptionProvider:
    """Send WAV audio through chat completions and return one timed segment."""

    name = "openai_audio"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        session_id: str | None = None,
        timeout: float = 180.0,
        client: httpx.Client | None = None,
        max_request_bytes: int | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.session_id = session_id
        self._client = client or httpx.Client(timeout=timeout)
        self.max_request_bytes = max_request_bytes

    def transcribe(self, audio_path: str) -> list[Segment]:
        path = Path(audio_path)
        headers = openai_compatible_headers(
            self.api_key, self.base_url, self.session_id
        )
        segments: list[Segment] = []
        chunk_options = (
            {"max_bytes": self.max_request_bytes}
            if self.max_request_bytes is not None
            else {}
        )
        with bounded_audio_chunks(path, **chunk_options) as chunks:
            hostname = (urlsplit(self.base_url).hostname or "").lower()
            is_opencode = hostname == "opencode.ai" or hostname.endswith(
                ".opencode.ai"
            )
            for chunk in chunks:
                try:
                    encoded = base64.b64encode(chunk.path.read_bytes()).decode("ascii")
                except OSError as exc:
                    raise TransientFailure(
                        f"could not read transcription audio: {exc}"
                    ) from exc
                payload = {
                    "model": self.model,
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "input_audio",
                                    "input_audio": {"data": encoded, "format": "wav"},
                                },
                                {
                                    "type": "text",
                                    "text": "Transcribe this recording.",
                                },
                            ],
                        },
                    ],
                }
                if is_opencode:
                    payload["reasoning_effort"] = "none"
                try:
                    response = self._client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload,
                    )
                except (httpx.TimeoutException, httpx.TransportError) as exc:
                    raise TransientFailure(
                        f"audio transcription request failed: {exc}"
                    ) from exc
                raise_for_provider_status("transcription", response)
                try:
                    body = response.json()
                    message = body["choices"][0]["message"]
                except (ValueError, KeyError, IndexError, TypeError) as exc:
                    raise TransientFailure(
                        "audio transcription provider returned an unexpected body"
                    ) from exc
                if not isinstance(message, dict):
                    raise TransientFailure(
                        "audio transcription provider returned an unexpected body"
                    )
                text = _message_text(message)
                if text:
                    duration = _audio_duration(chunk.path) or chunk.duration_seconds
                    segments.append(
                        Segment(
                            start=chunk.offset_seconds,
                            end=chunk.offset_seconds + duration,
                            text=text,
                        )
                    )
        return segments
