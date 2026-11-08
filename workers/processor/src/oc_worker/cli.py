"""Standalone OpenContext CLI.

The command runs the same media extraction, provider, aggregation, and
context-export code used by the worker, without requiring the web API or a
database. It is intended for local analysis and CI fixtures.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Any

from oc_worker import aggregation, context
from oc_worker.config import Settings
from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.ffmpeg import extract_audio, extract_frames, probe
from oc_worker.models import DetailLevel, OCRObservation, VisualObservation
from oc_worker.pipeline import MAX_DURATION_SECONDS, NOT_A_VIDEO_MESSAGE, TOO_LONG_MESSAGE
from oc_worker.providers import build_text, build_transcription, build_vision

log = logging.getLogger("oc_worker.cli")


def analyze_file(
    video: Path,
    settings: Settings,
    *,
    detail_level: DetailLevel = DetailLevel.MEDIUM,
) -> tuple[str, dict[str, Any]]:
    """Analyze one local video and return Markdown plus the JSON payload."""
    if not video.is_file():
        raise PermanentFailure(f"Video not found: {video}")

    probed = probe(str(video), settings.ffmpeg_path or None)
    if not probed.get("video_present"):
        raise PermanentFailure(NOT_A_VIDEO_MESSAGE)
    duration = probed.get("duration")
    if duration is None or float(duration) > MAX_DURATION_SECONDS:
        raise PermanentFailure(TOO_LONG_MESSAGE)

    transcription = build_transcription(settings)
    vision = build_vision(settings)
    text = build_text(settings)
    if vision is None:
        raise PermanentFailure(
            f"No vision provider configured (VISION_PROVIDER={settings.vision_provider})"
        )

    with tempfile.TemporaryDirectory(prefix="opencontext-cli-") as tmp:
        workdir = Path(tmp)
        audio_path = workdir / "audio.wav"
        segments = []
        if probed.get("audio_present"):
            extract_audio(str(video), str(audio_path), settings.ffmpeg_path or None)
            if transcription is None:
                raise PermanentFailure(
                    "Audio is present but no transcription provider is configured "
                    f"(TRANSCRIPTION_PROVIDER={settings.transcription_provider})"
                )
            segments = transcription.transcribe(str(audio_path))

        frames = extract_frames(
            str(video),
            workdir / "frames",
            ffmpeg_path=settings.ffmpeg_path or None,
        )
        observations = []
        ocr = []
        for frame in frames:
            timestamp = float(frame["timestamp"])
            if not aggregation.frame_selected(timestamp, detail_level):
                continue
            raw = vision.analyze(
                Path(frame["path"]).read_bytes(),
                {
                    "timestampSec": timestamp,
                    "detailLevel": detail_level.value,
                    "sourceName": video.name,
                    "durationSec": duration,
                },
            )
            aggregation.mark_interaction_certainty(raw)
            raw["timestampSec"] = timestamp
            raw["provider"] = vision.name
            observation = VisualObservation.model_validate(raw)
            observations.append(observation)
            for text_item in observation.visibleText:
                if text_item.strip():
                    ocr.append(
                        OCRObservation(
                            timestampSec=timestamp,
                            text=text_item.strip(),
                            provider=vision.name,
                        )
                    )

        timeline = aggregation.build_timeline(observations, float(duration))
        markdown, payload = context.build_context(
            source_name=video.name,
            duration_sec=float(duration),
            detail_level=detail_level,
            segments=segments,
            observations=observations,
            ocr=ocr,
            timeline=timeline,
            text_provider=text,
        )
        return markdown, payload


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="opencontext",
        description="Turn a video into evidence-linked developer context.",
    )
    parser.add_argument("--version", action="version", version="%(prog)s 0.1.0")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="Analyze a local video file")
    analyze.add_argument("video", type=Path)
    analyze.add_argument("--out", type=Path, help="Write Markdown to this path")
    analyze.add_argument("--json", type=Path, dest="json_out", help="Write JSON to this path")
    analyze.add_argument(
        "--detail-level",
        choices=[level.value for level in DetailLevel],
        default=DetailLevel.MEDIUM.value,
    )
    analyze.add_argument("--transcription-provider")
    analyze.add_argument("--transcription-model")
    analyze.add_argument("--vision-provider")
    analyze.add_argument("--vision-model")
    analyze.add_argument("--text-provider")
    analyze.add_argument("--ffmpeg-path")
    analyze.add_argument(
        "--offline",
        action="store_true",
        help="Use deterministic fixture transcription and vision output.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command != "analyze":
        return 2

    base = Settings.from_env()
    transcription_provider = (
        "fixture" if args.offline else args.transcription_provider or base.transcription_provider
    )
    vision_provider = (
        "fixture" if args.offline else args.vision_provider or base.vision_provider
    )
    text_provider = "template" if args.offline else args.text_provider or base.text_provider
    settings = replace(
        base,
        transcription_provider=transcription_provider,
        transcription_model=args.transcription_model or base.transcription_model,
        vision_provider=vision_provider,
        vision_model=args.vision_model or base.vision_model,
        text_provider=text_provider,
        ffmpeg_path=args.ffmpeg_path or base.ffmpeg_path,
    )
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        markdown, payload = analyze_file(
            args.video,
            settings,
            detail_level=DetailLevel(args.detail_level),
        )
    except (PermanentFailure, TransientFailure, RuntimeError, ValueError) as exc:
        log.error("%s", exc)
        return 1

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(markdown, encoding="utf-8")
        log.info("Wrote %s", args.out)
    else:
        print(markdown)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        log.info("Wrote %s", args.json_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
