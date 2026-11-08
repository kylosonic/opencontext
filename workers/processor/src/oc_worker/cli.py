"""Standalone OpenContext CLI.

The command runs the same media extraction, provider, aggregation, and
context-export code used by the worker, without requiring the web API or a
database. It is intended for local analysis and CI fixtures.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import replace
from importlib.util import find_spec
from pathlib import Path
from typing import Any

import httpx

from oc_worker import aggregation, context
from oc_worker.config import Settings, load_local_env
from oc_worker.errors import PermanentFailure, TransientFailure
from oc_worker.ffmpeg import extract_audio, extract_frames, probe
from oc_worker.models import DetailLevel, OCRObservation, VisualObservation
from oc_worker.pipeline import MAX_DURATION_SECONDS, NOT_A_VIDEO_MESSAGE, TOO_LONG_MESSAGE
from oc_worker.providers import build_ocr, build_text, build_transcription, build_vision

log = logging.getLogger("oc_worker.cli")

SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}


def _expand_inputs(inputs: list[Path]) -> list[Path]:
    """Expand directories into a stable list of supported video files."""
    videos: list[Path] = []
    for item in inputs:
        if item.is_dir():
            videos.extend(
                candidate
                for candidate in sorted(item.rglob("*"))
                if candidate.is_file()
                and candidate.suffix.lower() in SUPPORTED_VIDEO_EXTENSIONS
            )
        else:
            # Preserve missing paths so each one becomes a reported failure.
            videos.append(item)
    return videos


def _output_base(output_dir: Path, source: Path, used: set[str]) -> Path:
    """Return a stable, collision-safe stem for one input's outputs."""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", source.stem).strip("-._") or "video"
    candidate = stem
    counter = 2
    while candidate.casefold() in used:
        candidate = f"{stem}-{counter}"
        counter += 1
    used.add(candidate.casefold())
    return output_dir / candidate


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
            timeout=5,
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
) -> dict[str, str]:
    try:
        response = httpx.get(url, headers=headers or {}, timeout=3.0)
    except httpx.HTTPError as exc:
        return {"name": name, "status": "missing", "detail": f"{detail}; request failed: {exc}"}
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
) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    transcription = settings.transcription_provider.lower()
    if transcription == "fixture":
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
    else:
        checks.append(
            {
                "name": "transcription",
                "status": "unverified",
                "detail": f"provider is {transcription or 'not configured'}",
            }
        )

    vision = settings.vision_provider.lower()
    if vision == "fixture":
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
                )
            )
        else:
            checks.append({"name": "vision", "status": "unverified", "detail": detail})
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
                "status": "unverified",
                "detail": f"provider is {vision or 'not configured'}",
            }
        )

    ocr = settings.ocr_provider.lower()
    if ocr in ("", "none", "vision"):
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
                "status": "unverified",
                "detail": f"provider is {ocr or 'not configured'}",
            }
        )

    text = settings.text_provider.lower()
    if text in ("", "template"):
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
                "status": "unverified",
                "detail": f"provider is {text or 'not configured'}",
            }
        )
    return checks


def run_doctor(
    settings: Settings,
    *,
    offline: bool = False,
    check_network: bool = False,
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
    checks.extend(_provider_checks(settings, offline=offline, check_network=check_network))
    for check in checks:
        print(f"{check['status'].upper():10} {check['name']}: {check['detail']}")
    return 1 if any(check["status"] == "missing" for check in checks) else 0


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
    ocr_provider = build_ocr(settings)
    text = build_text(settings)
    if vision is None:
        raise PermanentFailure(
            f"No vision provider configured (VISION_PROVIDER={settings.vision_provider})"
        )

    with tempfile.TemporaryDirectory(
        prefix="opencontext-cli-", ignore_cleanup_errors=True
    ) as tmp:
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
            if ocr_provider is None:
                for text_item in observation.visibleText:
                    if text_item.strip():
                        ocr.append(
                            OCRObservation(
                                timestampSec=timestamp,
                                text=text_item.strip(),
                                provider=vision.name,
                            )
                        )
            else:
                recognized = ocr_provider.extract(
                    Path(frame["path"]).read_bytes(),
                    {
                        "timestampSec": timestamp,
                        "sourceName": video.name,
                    },
                )
                for item in recognized:
                    text_value = str(item.get("text") or "").strip()
                    if not text_value:
                        continue
                    ocr.append(
                        OCRObservation(
                            timestampSec=timestamp,
                            text=text_value,
                            confidence=item.get("confidence"),
                            provider=ocr_provider.name,
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
    analyze = commands.add_parser(
        "analyze",
        help="Analyze one video, multiple videos, or a directory",
    )
    analyze.add_argument("videos", nargs="+", type=Path)
    analyze.add_argument("--out", type=Path, help="Write Markdown to this path")
    analyze.add_argument("--json", type=Path, dest="json_out", help="Write JSON to this path")
    analyze.add_argument(
        "--output-dir",
        type=Path,
        help="Write one Markdown/JSON pair per input to this directory",
    )
    analyze.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress the per-item JSON batch summary.",
    )
    analyze.add_argument(
        "--detail-level",
        choices=[level.value for level in DetailLevel],
        default=DetailLevel.MEDIUM.value,
    )
    analyze.add_argument("--transcription-provider")
    analyze.add_argument("--transcription-model")
    analyze.add_argument("--vision-provider")
    analyze.add_argument("--vision-model")
    analyze.add_argument("--ocr-provider")
    analyze.add_argument("--ocr-language")
    analyze.add_argument("--tesseract-path")
    analyze.add_argument("--text-provider")
    analyze.add_argument("--ffmpeg-path")
    analyze.add_argument(
        "--offline",
        action="store_true",
        help="Use deterministic fixture transcription and vision output.",
    )
    doctor = commands.add_parser(
        "doctor",
        help="Check FFmpeg and configured provider readiness",
    )
    doctor_network = doctor.add_mutually_exclusive_group()
    doctor_network.add_argument(
        "--offline",
        action="store_true",
        help="Skip all network checks.",
    )
    doctor_network.add_argument(
        "--check-network",
        action="store_true",
        help="Make bounded requests to configured local/remote endpoints.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    load_local_env()
    base = Settings.from_env()
    if args.command == "doctor":
        return run_doctor(
            base,
            offline=args.offline,
            check_network=args.check_network,
        )
    if args.command != "analyze":
        return 2

    inputs = [Path(item) for item in args.videos]
    batch = (
        args.output_dir is not None
        or len(inputs) > 1
        or any(item.is_dir() for item in inputs)
    )
    if batch and (args.out or args.json_out):
        print(
            "error: --out/--json apply to one input; use --output-dir for batch analysis",
            file=sys.stderr,
        )
        return 2

    transcription_provider = (
        "fixture" if args.offline else args.transcription_provider or base.transcription_provider
    )
    vision_provider = (
        "fixture" if args.offline else args.vision_provider or base.vision_provider
    )
    ocr_provider = "fixture" if args.offline else args.ocr_provider or base.ocr_provider
    text_provider = "template" if args.offline else args.text_provider or base.text_provider
    settings = replace(
        base,
        transcription_provider=transcription_provider,
        transcription_model=args.transcription_model or base.transcription_model,
        vision_provider=vision_provider,
        vision_model=args.vision_model or base.vision_model,
        ocr_provider=ocr_provider,
        ocr_language=args.ocr_language or base.ocr_language,
        tesseract_path=args.tesseract_path or base.tesseract_path,
        text_provider=text_provider,
        ffmpeg_path=args.ffmpeg_path or base.ffmpeg_path,
    )
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    detail_level = DetailLevel(args.detail_level)
    if batch:
        videos = _expand_inputs(inputs)
        if not videos:
            log.error("No supported video files found")
            return 1
        output_dir = args.output_dir or Path("opencontext-output")
        output_dir.mkdir(parents=True, exist_ok=True)
        used: set[str] = set()
        results: list[dict[str, Any]] = []
        for video in videos:
            base_name = _output_base(output_dir, video, used)
            markdown_path = base_name.parent / f"{base_name.name}.md"
            json_path = base_name.parent / f"{base_name.name}.json"
            try:
                markdown, payload = analyze_file(video, settings, detail_level=detail_level)
                markdown_path.write_text(markdown, encoding="utf-8")
                json_path.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
                    encoding="utf-8",
                )
            except (PermanentFailure, TransientFailure, RuntimeError, ValueError) as exc:
                log.error("%s: %s", video, exc)
                results.append(
                    {
                        "input": str(video),
                        "status": "failed",
                        "error": str(exc),
                    }
                )
                continue
            results.append(
                {
                    "input": str(video),
                    "status": "ok",
                    "markdown": str(markdown_path),
                    "json": str(json_path),
                    "evidenceCount": len(payload.get("evidence") or []),
                }
            )

        succeeded = sum(item["status"] == "ok" for item in results)
        summary = {
            "total": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
            "results": results,
        }
        if not args.quiet:
            print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
        return 0 if summary["failed"] == 0 else 1

    video = inputs[0]
    try:
        markdown, payload = analyze_file(video, settings, detail_level=detail_level)
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
