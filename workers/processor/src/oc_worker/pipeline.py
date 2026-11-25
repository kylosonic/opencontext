"""Stage orchestration: EXTRACTING → TRANSCRIBING → ANALYZING →
AGGREGATING → GENERATING_CONTEXT (weights 20/25/35/10/10).

Implements the retry and resume semantics of jobs.md B4-B7:

- Transient failures are retried within the stage (3 retries, backoff
  2s/8s/20s, or a longer provider Retry-After) via `run_with_retry`;
  they stay invisible unless exhausted,
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
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from oc_worker import aggregation, context
from oc_worker.api_client import ApiClient, run_with_retry
from oc_worker.config import Settings
from oc_worker.errors import (
    JobAbort,
    PermanentFailure,
    ProcessingCancelled,
    TransientFailure,
    bind_abort,
)
from oc_worker.ffmpeg import extract_audio, extract_frames, extract_image_frame, probe
from oc_worker.models import (
    DetailLevel,
    OCRObservation,
    Segment,
    VisualObservation,
    clamp_segments_to_duration,
)
from oc_worker.pdf import MAX_PDF_PAGES, extract_pdf_pages
from oc_worker.plugins import (
    apply_context_plugins,
    apply_frame_plugins,
    load_plugins,
    parse_plugin_specs,
)
from oc_worker.providers import build_ocr, build_text, build_transcription, build_vision
from oc_worker.providers.http_status import provider_session
from oc_worker.providers.ocr.base import OcrProvider
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
NOT_AN_IMAGE_MESSAGE = "This file is not a valid image"
NOT_A_PDF_MESSAGE = "This file is not a valid PDF"
NOT_AN_AUDIO_MESSAGE = "This file is not a valid audio file"
TOO_LONG_MESSAGE = "Video is longer than the 30-minute limit"
NO_AUDIO_REASON = "NO_AUDIO"
LEASE_HEARTBEAT_SECONDS = 60.0

# Injectable ffmpeg entry points (tests substitute fakes).
ProbeFn = Callable[[str], dict[str, Any]]
ExtractAudioFn = Callable[[str, str], bool]
ExtractFramesFn = Callable[[str, str], list[dict[str, Any]]]
ExtractImageFn = Callable[[str, str], dict[str, Any]]
ExtractPdfFn = Callable[[str, str], list[dict[str, Any]]]


class Pipeline:
    """Runs one claimed job through the five stages against the API."""

    def __init__(
        self,
        api: ApiClient,
        settings: Settings,
        *,
        transcription_provider: TranscriptionProvider | None = None,
        vision_provider: VisionProvider | None = None,
        ocr_provider: OcrProvider | None = None,
        text_provider: TextProvider | None = None,
        probe_fn: ProbeFn | None = None,
        extract_audio_fn: ExtractAudioFn | None = None,
        extract_frames_fn: ExtractFramesFn | None = None,
        extract_image_fn: ExtractImageFn | None = None,
        extract_pdf_fn: ExtractPdfFn | None = None,
        job_timeout_seconds: float | None = None,
        plugins: Sequence[Any] | None = None,
    ) -> None:
        self.api = api
        self.settings = settings
        self.plugins: list[Any] = (
            list(plugins)
            if plugins is not None
            else load_plugins(
                parse_plugin_specs(settings.plugins),
                include_entry_points=settings.load_entrypoint_plugins,
            )
        )
        self.transcription_provider = (
            transcription_provider
            if transcription_provider is not None
            else build_transcription(settings)
        )
        self.vision_provider = (
            vision_provider if vision_provider is not None else build_vision(settings)
        )
        self.ocr_provider = (
            ocr_provider if ocr_provider is not None else build_ocr(settings)
        )
        self._ocr_disabled = settings.ocr_provider.strip().lower() == "off"
        self.text_provider = text_provider if text_provider is not None else build_text(settings)
        configured_ffmpeg = settings.ffmpeg_path or None
        self._probe = (
            probe_fn
            if probe_fn is not None
            else lambda source: probe(source, configured_ffmpeg)
        )
        self._extract_audio = (
            extract_audio_fn
            if extract_audio_fn is not None
            else lambda source, destination: extract_audio(
                source, destination, configured_ffmpeg
            )
        )
        self._extract_frames = (
            extract_frames_fn
            if extract_frames_fn is not None
            else lambda source, output_dir: extract_frames(
                source, output_dir, ffmpeg_path=configured_ffmpeg
            )
        )
        # A caller-provided extractor has no fps/max-frame arguments, so only
        # the built-in path can guarantee bounded production extraction.
        self._bounded_frame_extraction = extract_frames_fn is None
        self._extract_image = (
            extract_image_fn
            if extract_image_fn is not None
            else lambda source, destination: extract_image_frame(
                source, destination, ffmpeg_path=configured_ffmpeg
            )
        )
        self._extract_pdf = (
            extract_pdf_fn
            if extract_pdf_fn is not None
            else lambda source, output_dir: extract_pdf_pages(
                source, output_dir, max_pages=MAX_PDF_PAGES
            )
        )
        configured_timeout = (
            job_timeout_seconds
            if job_timeout_seconds is not None
            else settings.worker_job_timeout_seconds
        )
        self.job_timeout_seconds = max(0.0, float(configured_timeout))
        self._current_stage = "EXTRACTING"
        self._heartbeat_stop: threading.Event | None = None
        self._heartbeat_thread: threading.Thread | None = None
        self._cancel = JobAbort()

    # -- helpers ----------------------------------------------------------

    def _stage_state(self, job: dict[str, Any], stage: str) -> dict[str, Any]:
        for state in job.get("stageStates") or []:
            if state.get("stage") == stage:
                return state
        return {}

    def _attempt(self, job: dict[str, Any], stage: str) -> int:
        previous = self._stage_state(job, stage).get("attempt") or 0
        return int(previous) + 1

    def _heartbeat_loop(self, job_id: str, stop: threading.Event) -> None:
        while not stop.wait(LEASE_HEARTBEAT_SECONDS):
            try:
                self.api.renew_lease(
                    job_id,
                    stage=self._current_stage,
                    progress=0,
                )
            except (PermanentFailure, TransientFailure) as exc:
                log.warning(
                    "job=%s stage=%s lease_heartbeat_error=%s",
                    job_id,
                    self._current_stage,
                    exc,
                )
                if isinstance(exc, PermanentFailure):
                    # A rejected lease means another worker may own the job.
                    # Stop provider and FFmpeg work instead of issuing more
                    # fenced mutations against someone else's claim.
                    self._cancel.reason = f"Job lease lost: {exc}"
                    self._cancel.abort()
                    return

    def _start_heartbeat(self, job_id: str) -> None:
        stop = threading.Event()
        thread = threading.Thread(
            target=self._heartbeat_loop,
            args=(job_id, stop),
            name=f"lease-heartbeat-{job_id}",
            daemon=True,
        )
        self._heartbeat_stop = stop
        self._heartbeat_thread = thread
        thread.start()

    def _stop_heartbeat(self) -> None:
        stop = self._heartbeat_stop
        thread = self._heartbeat_thread
        self._heartbeat_stop = None
        self._heartbeat_thread = None
        if stop is not None:
            stop.set()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5)

    def _check_deadline(self) -> None:
        self._cancel.check()

    def abort(self) -> None:
        """Abort this isolated job context when shutdown grace is exhausted."""
        self._cancel.abort()

    def fork(self) -> Pipeline:
        """Create isolated mutable state while sharing immutable providers."""
        return Pipeline(
            self.api,
            self.settings,
            transcription_provider=self.transcription_provider,
            vision_provider=self.vision_provider,
            ocr_provider=self.ocr_provider,
            text_provider=self.text_provider,
            probe_fn=self._probe,
            extract_audio_fn=self._extract_audio,
            extract_frames_fn=(
                None
                if self._bounded_frame_extraction
                else self._extract_frames
            ),
            extract_image_fn=self._extract_image,
            extract_pdf_fn=self._extract_pdf,
            job_timeout_seconds=self.job_timeout_seconds,
        )

    def _timed(self, function: Callable[[], Any]) -> Any:
        self._check_deadline()
        result = function()
        self._check_deadline()
        return result

    def _start_deadline(self) -> None:
        self._cancel = JobAbort(
            f"Processing exceeded the {int(self.job_timeout_seconds)}-second job limit"
        )
        self._cancel.set_deadline(time.monotonic() + self.job_timeout_seconds)

        def expire() -> None:
            self._cancel.abort()

        self._deadline_timer = threading.Timer(self.job_timeout_seconds, expire)
        self._deadline_timer.daemon = True
        self._deadline_timer.start()

    def _done(self, job: dict[str, Any], stage: str) -> bool:
        return self._stage_state(job, stage).get("status") in ("SUCCEEDED", "SKIPPED")

    @staticmethod
    def _source_kind(job: dict[str, Any]) -> str:
        source = job.get("source")
        if isinstance(source, dict) and source.get("kind") in (
            "video",
            "image",
            "pdf",
            "audio",
        ):
            return str(source["kind"])
        extension = ""
        if isinstance(source, dict):
            extension = str(source.get("ext") or "").lower().lstrip(".")
        if not extension:
            filename = str(job.get("displayName") or "")
            extension = filename.rpartition(".")[2].lower()
        if extension in {"png", "jpg", "jpeg", "webp"}:
            return "image"
        if extension == "pdf":
            return "pdf"
        if extension in {"mp3", "m4a", "wav", "ogg", "aac", "flac"}:
            return "audio"
        return "video"

    # -- stages -----------------------------------------------------------

    def _probe_and_validate_source(
        self,
        source_kind: str,
        src: Path,
        sources: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], float]:
        if source_kind == "video":
            probed = self._probe(str(src))
            if not probed.get("video_present"):
                raise PermanentFailure(NOT_A_VIDEO_MESSAGE)
            duration_value = probed.get("duration")
            if duration_value is None or float(duration_value) > MAX_DURATION_SECONDS:
                raise PermanentFailure(TOO_LONG_MESSAGE)
            return probed, float(duration_value)
        if source_kind == "audio":
            probed = self._probe(str(src))
            if not probed.get("audio_present"):
                raise PermanentFailure(NOT_AN_AUDIO_MESSAGE)
            duration_value = probed.get("duration")
            if duration_value is None or float(duration_value) > MAX_DURATION_SECONDS:
                raise PermanentFailure("Audio is longer than the 30-minute limit")
            return probed, float(duration_value)
        if source_kind == "image":
            if len(sources) > 10:
                raise PermanentFailure("Image-set jobs accept at most 10 images")
            for asset in sources:
                image_probe = self._probe(str(asset["path"]))
                if not image_probe.get("video_present"):
                    raise PermanentFailure(NOT_AN_IMAGE_MESSAGE)
                width = int(image_probe.get("width") or 0)
                height = int(image_probe.get("height") or 0)
                if width <= 0 or height <= 0:
                    raise PermanentFailure(NOT_AN_IMAGE_MESSAGE)
                if width * height > 40_000_000:
                    raise PermanentFailure(
                        "Image dimensions are too large — the limit is 40 megapixels"
                    )
            return self._probe(str(src)), 0.0
        if source_kind == "pdf":
            return {"width": None, "height": None, "audio_present": False}, 0.0
        raise PermanentFailure("Unsupported source media")

    def _extract_image_frames(
        self, sources: list[dict[str, Any]], workdir: Path
    ) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        for index, asset in enumerate(sources):
            frame = self._timed(
                lambda asset=asset, index=index: self._extract_image(
                    str(asset["path"]),
                    str(workdir / "frames" / f"image_{index + 1:03d}.jpg"),
                )
            )
            frames.append(
                {
                    **frame,
                    "sourceKind": "image",
                    "sourceIndex": index,
                    "sourceName": asset.get("filename") or f"Image {index + 1}",
                    "frameId": f"image-{index + 1:02d}",
                    "artifactTimestamp": float(index + 1),
                }
            )
        return frames

    def _extract_pdf_frames(self, src: Path, workdir: Path) -> list[dict[str, Any]]:
        pages = self._timed(lambda: self._extract_pdf(str(src), str(workdir / "pages")))
        if not pages:
            raise PermanentFailure(NOT_A_PDF_MESSAGE)
        return [
            {
                "timestamp": 0.0,
                "path": page["path"],
                "sourceKind": "pdf",
                "sourceIndex": int(page["pageNumber"]) - 1,
                "sourceName": f"PDF page {page['pageNumber']}",
                "frameId": f"pdf-page-{int(page['pageNumber']):02d}",
                "embeddedText": page.get("text") or "",
                "artifactTimestamp": float(page["pageNumber"]),
            }
            for page in pages
        ]

    def _extract_video_frames(
        self,
        src: Path,
        primary: dict[str, Any],
        workdir: Path,
        duration: float,
        detail_level: DetailLevel,
    ) -> list[dict[str, Any]]:
        if self._bounded_frame_extraction and duration and duration > 0:
            frame_fps = aggregation.target_frame_fps(
                duration, detail_level, self.settings.vision_max_frames
            )
            sampling_kwargs = (
                {
                    "sampling_mode": "hybrid",
                    "scene_threshold": self.settings.scene_change_threshold,
                }
                if self.settings.frame_sampling_mode == "hybrid"
                else {}
            )
            frames = self._timed(
                lambda: extract_frames(
                    str(src),
                    str(workdir / "frames"),
                    fps=frame_fps,
                    max_frames=self.settings.vision_max_frames,
                    ffmpeg_path=self.settings.ffmpeg_path or None,
                    **sampling_kwargs,
                )
            )
            # These frames were already sampled evenly by FFmpeg under
            # the provider cap. Reapplying the old 1-fps timestamp stride
            # would discard almost every fractional-fps sample.
            for frame in frames:
                frame["boundedSampling"] = True
        else:
            frames = self._timed(
                lambda: self._extract_frames(str(src), str(workdir / "frames"))
            )
        for frame in frames:
            frame.update(
                {
                    "sourceKind": "video",
                    "sourceIndex": 0,
                    "sourceName": primary.get("filename"),
                    "frameId": None,
                }
            )
        return frames

    def _extracting(
        self,
        job: dict[str, Any],
        workdir: Path,
        resume: bool,
        detail_level: DetailLevel = DetailLevel.MEDIUM,
    ) -> tuple[dict[str, Any], Path | None, list[dict[str, Any]]]:
        self._current_stage = "EXTRACTING"
        job_id = job["id"]
        self._check_deadline()
        source_kind = self._source_kind(job)
        sources = self.api.download_sources(job_id, workdir)
        if not sources:
            raise PermanentFailure("The job has no downloadable source media")
        primary = sources[0]
        src = Path(primary["path"])
        if not resume:
            self.api.progress(
                job_id, stage="EXTRACTING", stage_status="RUNNING", progress=0,
                message="Probing source",
            )
        probed, duration = self._probe_and_validate_source(source_kind, src, sources)

        audio_path: Path | None = None
        if source_kind in ("video", "audio") and probed.get("audio_present"):
            if not resume:
                self.api.progress(
                    job_id, stage="EXTRACTING", stage_status="RUNNING", progress=35,
                    message="Extracting audio",
                )
            audio_path = workdir / "audio.wav"
            extracted = self._timed(
                lambda: self._extract_audio(str(src), str(audio_path))
            )
            if not extracted:
                audio_path = None
                probed["audio_present"] = False
            elif not resume:
                self.api.upload_artifact(job_id, kind="AUDIO", file_path=audio_path)

        if not resume:
            extract_messages = {
                "image": "Preparing image",
                "pdf": "Rendering PDF pages",
                "audio": "Preparing audio transcript",
            }
            self.api.progress(
                job_id,
                stage="EXTRACTING",
                stage_status="RUNNING",
                progress=60,
                message=extract_messages.get(source_kind, "Extracting frames"),
            )
        if source_kind == "image":
            frames = self._extract_image_frames(sources, workdir)
        elif source_kind == "pdf":
            frames = self._extract_pdf_frames(src, workdir)
        elif source_kind == "video":
            frames = self._extract_video_frames(
                src, primary, workdir, duration, detail_level
            )
        else:
            frames = []

        if self.plugins:
            frames = apply_frame_plugins(
                self.plugins,
                frames,
                {
                    "jobId": job_id,
                    "sourceKind": source_kind,
                    "durationSec": duration,
                },
            )

        if not resume:
            for frame in frames:
                self.api.upload_artifact(
                    job_id,
                    kind="FRAME",
                    file_path=frame["path"],
                    timestamp_sec=frame.get(
                        "artifactTimestamp", frame["timestamp"]
                    ),
                )
        probe_data = {
            "durationSec": duration,
            "audioPresent": bool(probed.get("audio_present")),
            "frameCount": len(frames),
        }
        if probed.get("width") is not None:
            probe_data["width"] = probed["width"]
        if probed.get("height") is not None:
            probe_data["height"] = probed["height"]
        if source_kind != "video":
            source_assets = (
                [
                    {
                        "name": frame["sourceName"],
                        "kind": source_kind,
                        "order": index,
                    }
                    for index, frame in enumerate(frames)
                ]
                if source_kind == "pdf"
                else [
                    {
                        "name": asset.get("filename") or f"Source {index + 1}",
                        "kind": asset.get("kind") or source_kind,
                        "order": index,
                    }
                    for index, asset in enumerate(sources)
                ]
            )
            probe_data.update(
                {
                    "sourceKind": source_kind,
                    "assetCount": len(sources),
                    "sourceAssets": source_assets,
                    **({"pageCount": len(frames)} if source_kind == "pdf" else {}),
                }
            )
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
        self,
        job: dict[str, Any],
        audio_path: Path | None,
        resume: bool,
        duration_sec: float | None,
    ) -> list[Segment]:
        self._current_stage = "TRANSCRIBING"
        self._check_deadline()
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
        with provider_session(f"opencontext-{job_id}"):
            segments = self._timed(
                lambda: run_with_retry(
                    lambda: self.transcription_provider.transcribe(str(audio_path))
                )
            )
        # Speech models can end past the media; the stored segments are the
        # source of truth for the results view, so bound them before sending.
        segments = clamp_segments_to_duration(segments, duration_sec)
        if not resume:
            self.api.stage_result(
                job_id,
                stage="TRANSCRIBING",
                outcome="SKIPPED" if not segments else "SUCCEEDED",
                attempt=self._attempt(job, "TRANSCRIBING"),
                reason=NO_AUDIO_REASON if not segments else None,
                data=(
                    {"segments": [segment.model_dump() for segment in segments]}
                    if segments
                    else None
                ),
            )
        return segments

    def _analyze_frames(
        self,
        job: dict[str, Any],
        frames: list[dict[str, Any]],
        detail_level: DetailLevel,
        duration_sec: float | None,
        *,
        report_progress: bool,
    ) -> tuple[list[VisualObservation], list[OCRObservation]]:
        job_id = job["id"]
        selected = [
            frame
            for frame in frames
            if frame.get("sourceKind") != "video"
            or frame.get("boundedSampling")
            or aggregation.frame_selected(float(frame["timestamp"]), detail_level)
        ]
        selected = aggregation.limit_frames(selected, self.settings.vision_max_frames)
        stop_after_failure = threading.Event()

        def analyze_one(
            index: int, frame: dict[str, Any]
        ) -> tuple[int, dict[str, Any], list[dict[str, Any]]]:
            if stop_after_failure.is_set():
                return index, {}, []
            previous_abort = bind_abort(self._cancel)
            try:
                frame_bytes = Path(frame["path"]).read_bytes()
                vision_context = {
                    "timestampSec": float(frame["timestamp"]),
                    "detailLevel": detail_level.value,
                    "jobName": job.get("displayName"),
                    "sessionId": f"opencontext-{job_id}",
                    "durationSec": duration_sec,
                    "sourceKind": self._source_kind(job),
                    "sourceIndex": int(frame.get("sourceIndex") or 0),
                    "sourceName": frame.get("sourceName"),
                }

                def log_vision_retry(exc: Exception, delay: float) -> None:
                    log.warning(
                        "job=%s stage=ANALYZING frame=%d/%d provider_retry "
                        "error=%r retry_in=%.1fs",
                        job_id,
                        index + 1,
                        len(selected),
                        str(exc),
                        delay,
                    )

                raw = self._timed(
                    lambda: run_with_retry(
                        lambda: self.vision_provider.analyze(frame_bytes, vision_context),
                        on_retry=log_vision_retry,
                    )
                )
                raw = aggregation.mark_interaction_certainty(raw)
                raw["timestampSec"] = float(frame["timestamp"])
                raw["frameId"] = frame.get("frameId")
                source_index = (
                    int(frame["sourceIndex"])
                    if frame.get("sourceKind") != "video"
                    and frame.get("sourceIndex") is not None
                    else None
                )
                if source_index is not None:
                    raw["sourceIndex"] = source_index
                raw["provider"] = self.vision_provider.name
                ocr: list[dict[str, Any]] = []
                embedded_text = str(frame.get("embeddedText") or "").strip()
                if embedded_text:
                    for line in embedded_text.splitlines():
                        text = line.strip()
                        if text:
                            ocr.append(
                                {
                                    "timestampSec": float(frame["timestamp"]),
                                    "frameId": frame.get("frameId"),
                                    "sourceIndex": source_index,
                                    "text": text,
                                    "provider": "pdf_text",
                                }
                            )
                if self._ocr_disabled:
                    pass
                elif self.ocr_provider is None:
                    for text_item in raw.get("visibleText") or []:
                        # canonical visibleText entries are strings; legacy
                        # providers may still send {text, confidence?} dicts.
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
                            "frameId": frame.get("frameId"),
                            "sourceIndex": source_index,
                            "text": text,
                            "provider": self.vision_provider.name,
                        }
                        if confidence is not None:
                            row["confidence"] = confidence
                        ocr.append(row)
                else:
                    def log_ocr_retry(exc: Exception, delay: float) -> None:
                        log.warning(
                            "job=%s stage=ANALYZING frame=%d/%d ocr_retry "
                            "error=%r retry_in=%.1fs",
                            job_id,
                            index + 1,
                            len(selected),
                            str(exc),
                            delay,
                        )

                    recognized = self._timed(
                        lambda: run_with_retry(
                            lambda: self.ocr_provider.extract(frame_bytes, vision_context),
                            on_retry=log_ocr_retry,
                        )
                    )
                    for item in recognized:
                        if not isinstance(item, dict):
                            continue
                        text = str(item.get("text") or "").strip()
                        if not text:
                            continue
                        row: dict[str, Any] = {
                            "timestampSec": float(frame["timestamp"]),
                            "frameId": frame.get("frameId"),
                            "sourceIndex": source_index,
                            "text": text,
                            "provider": self.ocr_provider.name,
                        }
                        if item.get("confidence") is not None:
                            row["confidence"] = item["confidence"]
                        ocr.append(row)
                return index, raw, ocr
            except BaseException:
                stop_after_failure.set()
                raise
            finally:
                bind_abort(previous_abort)

        observations: list[VisualObservation] = []
        ocr_items: list[OCRObservation] = []
        vision_concurrency = max(1, min(8, self.settings.vision_concurrency))
        if not selected:
            return observations, ocr_items
        pool = ThreadPoolExecutor(max_workers=vision_concurrency)
        completed_results: list[tuple[int, dict[str, Any], list[dict[str, Any]]]] = []
        futures = {
            pool.submit(analyze_one, index, frame): index
            for index, frame in enumerate(selected)
        }
        try:
            for completed_count, future in enumerate(as_completed(futures), start=1):
                result = future.result()
                completed_results.append(result)
                index = result[0]
                if report_progress:
                    self.api.progress(
                        job_id,
                        stage="ANALYZING",
                        stage_status="RUNNING",
                        progress=5 + round(90 * completed_count / len(selected)),
                        message=f"Analyzed frame {completed_count} of {len(selected)}",
                    )
                log.info(
                    "job=%s stage=ANALYZING frame=%d/%d status=analyzed",
                    job_id,
                    index + 1,
                    len(selected),
                )
        except BaseException:
            stop_after_failure.set()
            pool.shutdown(wait=True, cancel_futures=True)
            raise
        else:
            pool.shutdown(wait=True)

        for _, raw, ocr_raw in sorted(completed_results, key=lambda item: item[0]):
            raw["provider"] = self.vision_provider.name
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
        self._check_deadline()
        job_id = job["id"]
        if not frames:
            if not resume:
                self.api.stage_result(
                    job_id,
                    stage="ANALYZING",
                    outcome="SKIPPED",
                    attempt=self._attempt(job, "ANALYZING"),
                    reason="NO_VISUAL_MEDIA",
                    data={"observations": [], "ocr": []},
                )
            return [], []
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
            job,
            frames,
            detail_level,
            probe_data.get("durationSec"),
            report_progress=not resume,
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
        self._check_deadline()
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
        self._check_deadline()
        self.api.progress(
            job_id, stage="GENERATING_CONTEXT", stage_status="RUNNING", progress=30,
            message="Generating developer context",
        )
        markdown, payload = self._timed(
            lambda: context.build_context(
                source_name=job.get("displayName") or "Untitled recording",
                duration_sec=float(probe_data.get("durationSec") or 0.0),
                detail_level=detail_level,
                segments=segments,
                observations=observations,
                ocr=ocr_items,
                timeline=timeline,
                audio_present=bool(probe_data.get("audioPresent")),
                source_kind=self._source_kind(job),
                source_assets=probe_data.get("sourceAssets") or [],
                text_provider=self.text_provider,
                session_id=f"opencontext-{job_id}",
                compression_mode=self.settings.context_compression_mode,
                max_context_tokens=self.settings.context_max_tokens,
            )
        )
        if self.plugins:
            payload, markdown = apply_context_plugins(self.plugins, payload, markdown)
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
        self._start_deadline()
        previous_abort = bind_abort(self._cancel)
        self._start_heartbeat(job_id)
        try:
            with tempfile.TemporaryDirectory(
                prefix="oc-worker-", ignore_cleanup_errors=True
            ) as tmp:
                workdir = Path(tmp)
                resume_extracting = self._done(job, "EXTRACTING")
                probe_data, audio_path, frames = self._extracting(
                    job, workdir, resume_extracting, detail_level
                )

                resume_transcribing = self._done(job, "TRANSCRIBING")
                segments = self._transcribing(
                    job,
                    audio_path,
                    resume_transcribing,
                    probe_data.get("durationSec"),
                )

                resume_analyzing = self._done(job, "ANALYZING")
                observations, ocr_items = self._analyzing(
                    job, frames, detail_level, probe_data, resume_analyzing
                )

                timeline = self._aggregating(job, probe_data, observations)
                self._generating_context(
                    job, probe_data, detail_level, segments, observations, ocr_items, timeline
                )
                self._check_deadline()
                self.api.complete(job_id)
        except ProcessingCancelled as exc:
            self._fail(job_id, str(exc), "PERMANENT", retryable=False)
            return "failed"
        except PermanentFailure as exc:
            self._fail(job_id, str(exc), "PERMANENT", retryable=False)
            return "failed"
        except TransientFailure as exc:
            self._fail(
                job_id,
                str(exc),
                "TRANSIENT",
                retryable=True,
                retry_after_seconds=exc.retry_after_seconds,
                rate_limited=exc.rate_limited,
            )
            return "failed"
        except Exception as exc:
            log.exception("job=%s stage=%s unhandled_failure", job_id, self._current_stage)
            self._fail(
                job_id,
                f"{type(exc).__name__}: {exc}"[:2_000],
                "TRANSIENT",
                retryable=True,
            )
            return "failed"
        finally:
            self._stop_heartbeat()
            self._deadline_timer.cancel()
            bind_abort(previous_abort)
        elapsed = time.monotonic() - started
        log.info("job=%s status=completed duration=%.1fs", job_id, elapsed)
        return "completed"

    def _fail(
        self,
        job_id: str,
        error: str,
        failure_kind: str,
        *,
        retryable: bool,
        retry_after_seconds: float | None = None,
        rate_limited: bool = False,
    ) -> None:
        bounded_error = (error.strip() or "Unknown processing error")[:2_000]
        log.error(
            "job=%s stage=%s status=failed error=%r failure_kind=%s",
            job_id,
            self._current_stage,
            bounded_error,
            failure_kind,
        )
        try:
            self.api.fail(
                job_id,
                stage=self._current_stage,
                error=bounded_error,
                failure_kind=failure_kind,
                retryable=retryable,
                retry_after_sec=retry_after_seconds,
                rate_limited=rate_limited,
            )
        except Exception as exc:
            log.error("job=%s fail_report_error=%s", job_id, exc)
