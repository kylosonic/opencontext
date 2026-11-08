"""OpenAI-compatible transcription provider (zero extra dependencies).

POSTs the audio to `{OPENAI_BASE_URL}/audio/transcriptions` with
`response_format=verbose_json` + segment timestamps. Falls back to a
single whole-file segment when the server returns no segments.

Failure classification only: transient/timeout/429/5xx raise
TransientFailure, credential errors raise PermanentFailure. Retry with
backoff is the pipeline's responsibility (jobs.md B7).
"""

from __future__ import annotations

import httpx

from oc_worker.errors import TransientFailure
from oc_worker.models import Segment
from oc_worker.providers.http_status import raise_for_provider_status


class OpenAICompatibleTranscriptionProvider:
    name = "openai_compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 120.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._client = client or httpx.Client(timeout=timeout)

    def transcribe(self, audio_path: str) -> list[Segment]:
        url = f"{self.base_url}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            with open(audio_path, "rb") as handle:
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
            raise TransientFailure("transcription provider returned non-JSON") from exc

        segments: list[Segment] = []
        for raw in body.get("segments", []):
            try:
                segments.append(
                    Segment(
                        start=float(raw["start"]),
                        end=float(raw["end"]),
                        text=str(raw["text"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        text = body.get("text") or ""
        if not segments and text:
            segments.append(Segment(start=0.0, end=0.0, text=text))
        if not segments:
            raise TransientFailure("transcription provider returned no segments")
        return segments
