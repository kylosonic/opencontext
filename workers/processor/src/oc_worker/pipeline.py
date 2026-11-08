"""Stage orchestration: EXTRACTING → TRANSCRIBING → ANALYZING →
AGGREGATING → GENERATING_CONTEXT (weights 20/25/35/10/10).

Implements the retry and resume semantics of jobs.md B4-B7:

- Transient failures are retried within the stage (2 retries, backoff
  2s/8s) via `run_with_retry`; they stay invisible unless exhausted,
  in which case the job fails with `failureKind=TRANSIENT`.
- Permanent failures fail the job immediately with the specific reason
  (B6: "This file is not a valid video" / "Video is longer than the
  30-minute limit").
- Resume (B5): the server's `stageStates` is the single authority —
  stages already SUCCEEDED/SKIPPED are not re-reported. The worker
  still needs their local outputs (audio, frames, segments) for the
  downstream AGGREGATING/GENERATING_CONTEXT stages that the server
  always resets, so completed stages are re-derived locally in
  "shadow" mode: zero API progress/artifact/stage-result writes for
  them, so stored results stay untouched.
- Idempotency: stage-result/artifact upserts are safe to repeat; a
  worker restart re-checks `stageStates` before running anything.
"""

from __future__ import annotations

import logging
import tempfile
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from oc_worker import aggregation, context
from oc_worker.api_client import ApiClient, run_with_retry
from oc_worker.config import Settings
from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.ffmpeg import extract_audio, extract_frames, probe
from oc_worker.models import (
    DetailLevel,
    OCRObservation,
    Segment,
    VisualObservation,
)
from oc_worker.providers import build_text, build_transcription, build_vision
from oc_worker.providers.text.base import TextProvider
from oc_worker.providers.transcription.base import TranscriptionProvider
from oc_worker.providers.vision.base import VisionProvider

log = logging.getLogger("oc_worker.pipeline")

STAGE_ORDER = ("EXTRACTING", "TRANSCRIBING", "ANALYZING", "AGGREGATING", "GENERATING_CONTEXT")
STAGE_WEIGHTS = {
    "EXTRACTING": 20,
    "TRANSCRIBING": 25,
    "ANALYZING": 35,
    "AGGREGATING": 10,
    "GENERATING_CONTEXT": 10,
}
MAX_DURATION_SECONDS = 1800
NOT_A_VIDEO_MESSAGE = "This file is not a valid video"
TOO_LONG_MESSAGE = "Video is longer than the 30-minute limit"
NO_AUDIO_REASON = "NO_AUDIO"
VISION_CONCURRENCY = 2

# Injectable ffmpeg entry points (tests substitute fakes).
ProbeFn = Callable[[str], dict[str, Any]]
ExtractAudioFn = Callable[[str, str], bool]
ExtractFramesFn = Callable[[str, str], list[dict[str, Any]]]


class Pipeline:
    """Runs one claimed job through the five stages against the API."""

    def __init__(
        self,
        api: ApiClient,
        settings: Settings,
        *,
        transcription_provider: TranscriptionProvider | None = None,
        vision_provider: VisionProvider | None = None,
        text_provider: TextProvider | None = None,
        probe_fn: ProbeFn = probe,
        extract_audio_fn: ExtractAudioFn = extract_audio,
        extract_frames_fn: ExtractFramesFn = extract_frames,
    ) -> None:
        self.api = api
        self.settings = settings
        self.transcription_provider = (
            transcription_provider
            if transcription_provider is not None
            else build_transcription(settings)
        )
        self.vision_provider = (
            vision_provider if vision_provider is not None else build_vision(settings)
        )
        self.text_provider = text_provider if text_provider is not None else build_text(settings)
        self._probe = probe_fn
        self._extract_audio = extract_audio_fn
        self._extract_frames = extract_frames_fn
        self._current_stage = "EXTRACTING"

    # -- helpers ----------------------------------------------------------

    def _stage_state(self, job: dict[str, Any], stage: str) -> dict[str, Any]:
        for state in job.get("stageStates") or []:
            if state.get("stage") == stage:
                return state
        return {}

    def _attempt(self, job: dict[str, Any], stage: str) -> int:
        previous = self._stage_state(job, stage).get("attempt") or 0
        return int(previous) + 1

    def _done(self, job: dict[str, Any], stage: str) -> bool:
        return self._stage_state(job, stage).get("status") in ("SUCCEEDED", "SKIPPED")

    # -- stages -----------------------------------------------------------

    def _extracting(
        self, job: dict[str, Any], workdir: Path, resume: bool
    ) -> tuple[dict[str, Any], Path | None, list[dict[str, Any]]]:
        self._current_stage = "EXTRACTING"
        job_id = job["id"]
        src = workdir / "source.bin"
        self.api.download_source(job_id, src)
        if not resume:
            self.api.progress(
                job_id, stage="EXTRACTING", stage_status="RUNNING", progress=0,
                message="Probing source",
            )
        probed = self._probe(str(src))
        if not probed.get("video_present"):
            raise PermanentFailure(NOT_A_VIDEO_MESSAGE)
        duration = probed.get("duration")
        if duration is None or float(duration) > MAX_DURATION_SECONDS:
            raise PermanentFailure(TOO_LONG_MESSAGE)

        audio_path: Path | None = None
        if probed.get("audio_present"):
            if not resume:
                self.api.progress(
                    job_id, stage="EXTRACTING", stage_status="RUNNING", progress=35,
                    message="Extracting audio",
                )
            audio_path = workdir / "audio.wav"
            self._extract_audio(str(src), str(audio_path))
            if not resume:
                self.api.upload_artifact(job_id, kind="AUDIO", file_path=audio_path)

        if not resume:
            self.api.progress(
                job_id, stage="EXTRACTING", stage_status="RUNNING", progress=60,
                message="Extracting frames",
            )
        frames = self._extract_frames(str(src), str(workdir / "frames"))
        if not resume:
            for frame in frames:
                self.api.upload_artifact(
                    job_id,
                    kind="FRAME",
                    file_path=frame["path"],
                    timestamp_sec=frame["timestamp"],
                )
        probe_data = {
            "durationSec": duration,
            "width": probed.get("width"),
            "height": probed.get("height"),
            "audioPresent": bool(probed.get("audio_present")),
            "frameCount": len(frames),
        }
        if not resume:
            self.api.stage_result(
                job_id,
                stage="EXTRACTING",
                outcome="SUCCEEDED",
                attempt=self._attempt(job, "EXTRACTING"),
                data=probe_data,
            )
        return probe_data, audio_path, frames

    def _transcribing(
        self, job: dict[str, Any], audio_path: Path | None, resume: bool
    ) -> list[Segment]:
        self._current_stage = "TRANSCRIBING"
        job_id = job["id"]
        if audio_path is None:
            if not resume:
                self.api.stage_result(
                    job_id,
                    stage="TRANSCRIBING",
                    outcome="SKIPPED",
                    attempt=self._attempt(job, "TRANSCRIBING"),
                    reason=NO_AUDIO_REASON,
                )
            return []
        if self.transcription_provider is None:
            raise TransientFailure(
                "No transcription provider configured "
                f"(TRANSCRIPTION_PROVIDER={self.settings.transcription_provider})"
            )
        if not resume:
            self.api.progress(
                job_id, stage="TRANSCRIBING", stage_status="RUNNING", progress=10,
                message="Transcribing audio",
            )
        segments = run_with_retry(
            lambda: self.transcription_provider.transcribe(str(audio_path))
        )
        if not resume:
            self.api.stage_result(
                job_id,
                stage="TRANSCRIBING",
                outcome="SUCCEEDED",
                attempt=self._attempt(job, "TRANSCRIBING"),
                data={"segments": [segment.model_dump() for segment in segments]},
            )
        return segments

    def _analyze_frames(
        self,
        job: dict[str, Any],
        frames: list[dict[str, Any]],
        detail_level: DetailLevel,
        duration_sec: float | None,
    ) -> tuple[list[VisualObservation], list[OCRObservation]]:
        job_id = job["id"]
        selected = [
            frame
            for frame in frames
            if aggregation.frame_selected(float(frame["timestamp"]), detail_level)
        ]

        def analyze_one(frame: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
            frame_bytes = Path(frame["path"]).read_bytes()
            vision_context = {
                "timestampSec": float(frame["timestamp"]),
                "detailLevel": detail_level.value,
                "sourceName": job.get("displayName"),
                "durationSec": duration_sec,
            }
            raw = run_with_retry(
                lambda: self.vision_provider.analyze(frame_bytes, vision_context)
            )
            raw = aggregation.mark_interaction_certainty(raw)
            raw["timestampSec"] = float(frame["timestamp"])
            raw["provider"] = self.vision_provider.name
            ocr: list[dict[str, Any]] = []
            for text_item in raw.get("visibleText") or []:
                # canonical visibleText entries are strings; legacy providers
                # may still send {text, confidence?} dicts — accept both.
                if isinstance(text_item, str):
                    text = text_item.strip()
                    confidence: float | None = None
                elif isinstance(text_item, dict):
                    text = str(text_item.get("text") or "").strip()
                    confidence = text_item.get("confidence")
                else:
                    continue
                if not text:
                    continue
                row: dict[str, Any] = {
                    "timestampSec": float(frame["timestamp"]),
                    "text": text,
                    "provider": self.vision_provider.name,
                }
                if confidence is not None:
                    row["confidence"] = confidence
                ocr.append(row)
            return raw, ocr

        observations: list[VisualObservation] = []
        ocr_items: list[OCRObservation] = []
        with ThreadPoolExecutor(max_workers=VISION_CONCURRENCY) as pool:
            for raw, ocr_raw in pool.map(analyze_one, selected):
                observations.append(VisualObservation.model_validate(raw))
                ocr_items.extend(OCRObservation.model_validate(item) for item in ocr_raw)
        log.info("job=%s stage=ANALYZING frames_analyzed=%d", job_id, len(observations))
        return observations, ocr_items

    def _analyzing(
        self,
        job: dict[str, Any],
        frames: list[dict[str, Any]],
        detail_level: DetailLevel,
        probe_data: dict[str, Any],
        resume: bool,
    ) -> tuple[list[VisualObservation], list[OCRObservation]]:
        self._current_stage = "ANALYZING"
        job_id = job["id"]
        if self.vision_provider is None:
            raise TransientFailure(
                "No vision provider configured "
                f"(VISION_PROVIDER={self.settings.vision_provider})"
            )
        if not resume:
            self.api.progress(
                job_id, stage="ANALYZING", stage_status="RUNNING", progress=5,
                message="Analyzing visual frames",
            )
        observations, ocr_items = self._analyze_frames(
            job, frames, detail_level, probe_data.get("durationSec")
        )
        if not resume:
            self.api.stage_result(
                job_id,
                stage="ANALYZING",
                outcome="SUCCEEDED",
                attempt=self._attempt(job, "ANALYZING"),
                data={
                    # canonical observation shapes; None-valued optional
                    # fields are omitted (the web AnalyzeDataSchema rejects
                    # explicit nulls on optional keys)
                    "observations": [
                        obs.model_dump(exclude_none=True) for obs in observations
                    ],
                    "ocr": [item.model_dump(exclude_none=True) for item in ocr_items],
                },
            )
        return observations, ocr_items

    def _aggregating(
        self,
        job: dict[str, Any],
        probe_data: dict[str, Any],
        observations: list[VisualObservation],
    ) -> list[dict[str, Any]]:
        self._current_stage = "AGGREGATING"
        job_id = job["id"]
        self.api.progress(
            job_id, stage="AGGREGATING", stage_status="RUNNING", progress=20,
            message="Aggregating timeline",
        )
        # canonical scene rows {start, end, title?, summary} — the only
        # shape packages/schemas TimelineEntrySchema accepts (zod rejects
        # rich per-kind entries). GENERATING_CONTEXT reuses the same rows.
        timeline = aggregation.build_timeline(
            observations, probe_data.get("durationSec")
        )
        self.api.stage_result(
            job_id,
            stage="AGGREGATING",
            outcome="SUCCEEDED",
            attempt=self._attempt(job, "AGGREGATING"),
            data={"timeline": timeline},
        )
        return timeline

    def _generating_context(
        self,
        job: dict[str, Any],
        probe_data: dict[str, Any],
        detail_level: DetailLevel,
        segments: list[Segment],
        observations: list[VisualObservation],
        ocr_items: list[OCRObservation],
        timeline: list[dict[str, Any]],
    ) -> None:
        self._current_stage = "GENERATING_CONTEXT"
        job_id = job["id"]
        self.api.progress(
            job_id, stage="GENERATING_CONTEXT", stage_status="RUNNING", progress=30,
            message="Generating developer context",
        )
        markdown, payload = context.build_context(
            source_name=job.get("displayName") or "Untitled recording",
            duration_sec=float(probe_data.get("durationSec") or 0.0),
            detail_level=detail_level,
            segments=segments,
            observations=observations,
            ocr=ocr_items,
            timeline=timeline,
            text_provider=self.text_provider,
        )
        self.api.stage_result(
            job_id,
            stage="GENERATING_CONTEXT",
            outcome="SUCCEEDED",
            attempt=self._attempt(job, "GENERATING_CONTEXT"),
            data={"markdown": markdown, "json": payload},
        )

    # -- orchestration ----------------------------------------------------

    def run_job(self, job: dict[str, Any]) -> str:
        """Process one claimed job; returns "completed" or "failed"."""
        job_id = job["id"]
        detail_level = DetailLevel(str(job.get("detailLevel") or "MEDIUM").upper())
        started = time.monotonic()
        try:
            with tempfile.TemporaryDirectory(
                prefix="oc-worker-", ignore_cleanup_errors=True
            ) as tmp:
                workdir = Path(tmp)
                resume_extracting = self._done(job, "EXTRACTING")
                probe_data, audio_path, frames = self._extracting(job, workdir, resume_extracting)

                resume_transcribing = self._done(job, "TRANSCRIBING")
                segments = self._transcribing(job, audio_path, resume_transcribing)

                resume_analyzing = self._done(job, "ANALYZING")
                observations, ocr_items = self._analyzing(
                    job, frames, detail_level, probe_data, resume_analyzing
                )

                timeline = self._aggregating(job, probe_data, observations)
                self._generating_context(
                    job, probe_data, detail_level, segments, observations, ocr_items, timeline
                )
                self.api.complete(job_id)
        except PermanentFailure as exc:
            self._fail(job_id, str(exc), "PERMANENT", retryable=False)
            return "failed"
        except TransientFailure as exc:
            self._fail(job_id, str(exc), "TRANSIENT", retryable=True)
            return "failed"
        elapsed = time.monotonic() - started
        log.info("job=%s status=completed duration=%.1fs", job_id, elapsed)
        return "completed"

    def _fail(self, job_id: str, error: str, failure_kind: str, *, retryable: bool) -> None:
        log.error(
            "job=%s stage=%s status=failed error=%r failure_kind=%s",
            job_id,
            self._current_stage,
            error,
            failure_kind,
        )
        try:
            self.api.fail(
                job_id,
                stage=self._current_stage,
                error=error,
                failure_kind=failure_kind,
                retryable=retryable,
            )
        except (PermanentFailure, TransientFailure) as exc:
            log.error("job=%s fail_report_error=%s", job_id, exc)
