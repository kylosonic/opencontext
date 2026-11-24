"""OpenAI-compatible transcription provider (zero extra dependencies).

POSTs the audio to `{OPENAI_BASE_URL}/audio/transcriptions` with
`response_format=verbose_json` + segment timestamps. Falls back to a
single whole-file segment when the server returns no segments.

Failure classification only: transient/timeout/429/5xx raise
TransientFailure, credential errors raise PermanentFailure. Retry with
backoff is the pipeline's responsibility (jobs.md B7).
"""

from __future__ import annotations

import wave

import httpx

from oc_worker.errors import PermanentFailure, TransientFailure, check_abort
from oc_worker.models import Segment
from oc_worker.providers.http_status import (
    openai_compatible_headers,
    raise_for_provider_status,
)
from oc_worker.providers.transcription.audio_chunks import (
    MAX_SEGMENT_TEXT_CHARS,
    bounded_audio_chunks,
    timed_segments,
)


class OpenAICompatibleTranscriptionProvider:
    name = "openai_compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        session_id: str | None = None,
        timeout: float = 120.0,
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
        url = f"{self.base_url}/audio/transcriptions"
        headers = openai_compatible_headers(
            self.api_key, self.base_url, self.session_id
        )
        segments: list[Segment] = []
        chunk_options = (
            {"max_bytes": self.max_request_bytes}
            if self.max_request_bytes is not None
            else {}
        )
        try:
            with bounded_audio_chunks(audio_path, **chunk_options) as chunks:
                for chunk in chunks:
                    check_abort()
                    try:
                        with chunk.path.open("rb") as handle:
                            response = self._client.post(
                                url,
                                headers=headers,
                                files={"file": ("audio.wav", handle, "audio/wav")},
                                data={
                                    "model": self.model,
                                    "response_format": "verbose_json",
                                    "timestamp_granularities[]": "segment",
                                },
                            )
                    except (httpx.TimeoutException, httpx.TransportError) as exc:
                        raise TransientFailure(f"transcription request failed: {exc}") from exc
                    raise_for_provider_status("transcription", response)
                    try:
                        body = response.json()
                    except ValueError as exc:
                        raise TransientFailure(
                            "transcription provider returned non-JSON"
                        ) from exc
                    if not isinstance(body, dict):
                        raise TransientFailure(
                            "transcription provider returned an unexpected body"
                        )
                    raw_segments = body.get("segments")
                    if not isinstance(raw_segments, list):
                        raw_segments = []
                    chunk_segments: list[Segment] = []
                    for raw in raw_segments:
                        try:
                            start = chunk.offset_seconds + float(raw["start"])
                            end = max(start, chunk.offset_seconds + float(raw["end"]))
                            seg_text = str(raw["text"])
                        except (KeyError, TypeError, ValueError):
                            continue
                        if len(seg_text) > MAX_SEGMENT_TEXT_CHARS:
                            chunk_segments.extend(
                                timed_segments(seg_text, start, end - start)
                            )
                        else:
                            chunk_segments.append(
                                Segment(start=start, end=end, text=seg_text)
                            )
                    segments.extend(chunk_segments)
                    text = str(body.get("text") or "").strip()
                    if not chunk_segments and text:
                        segments.extend(
                            timed_segments(
                                text,
                                chunk.offset_seconds,
                                chunk.duration_seconds,
                            )
                        )
        except (OSError, EOFError, wave.Error, ZeroDivisionError, ValueError) as exc:
            raise PermanentFailure(
                f"could not process transcription audio: {exc}"
            ) from exc
        return segments
