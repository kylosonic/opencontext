"""Opt-in real vision smoke test through the OpenCode Go API."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from oc_worker.cli import analyze_file
from oc_worker.config import Settings, resolve_ffmpeg_path
from oc_worker.providers.vision.openai_compatible import OpenAICompatibleVisionProvider

ENABLED = os.getenv("OPENCONTEXT_OPENCODE_E2E") == "1"
FFMPEG = resolve_ffmpeg_path()
FFMPEG_AVAILABLE = Path(FFMPEG).is_file() or shutil.which(FFMPEG) is not None

pytestmark = pytest.mark.skipif(
    not ENABLED or not FFMPEG_AVAILABLE,
    reason="set OPENCONTEXT_OPENCODE_E2E=1 and install FFmpeg to run",
)


def _opencode_api_key() -> str | None:
    configured = os.getenv("OPENCODE_API_KEY") or os.getenv("OPENAI_API_KEY")
    if configured:
        return configured
    executable = shutil.which("opencode")
    if not executable:
        return None
    try:
        exported = subprocess.run(
            [executable, "auth", "export"],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        records = json.loads(exported.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    for record in records:
        if record.get("integrationID") != "opencode-go" or not record.get("active"):
            continue
        value = record.get("value") or {}
        key = value.get("key") if isinstance(value, dict) else None
        return str(key) if key else None
    return None


def _draw_ui_image(path: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (960, 640), "#f8fafc")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=30)
    small = ImageFont.load_default(size=22)
    draw.rectangle((90, 60, 870, 580), fill="white", outline="#94a3b8", width=3)
    draw.text((130, 100), "Checkout", fill="#0f172a", font=font)
    draw.text((130, 190), "Order 1042", fill="#334155", font=small)
    draw.text((130, 250), "Total $42.00", fill="#334155", font=small)
    draw.rounded_rectangle((130, 350, 390, 415), radius=14, fill="#2563eb")
    draw.text((180, 368), "Pay now", fill="white", font=small)
    draw.text((130, 500), "Visa ending 4242", fill="#64748b", font=small)
    image.save(path)


def test_real_opencode_vision_smoke(tmp_path: Path) -> None:
    api_key = _opencode_api_key()
    if not api_key:
        pytest.fail(
            "OpenCode Go stored authentication or OPENCODE_API_KEY is required.",
            pytrace=False,
        )
    base_url = os.getenv(
        "OPENAI_BASE_URL",
        "https://opencode.ai/inference/go/openai/v1",
    ).rstrip("/")
    model = os.getenv("VISION_MODEL", "hy4-flash-free")
    session_id = os.getenv("OPENCODE_SESSION_ID", "opencontext-vision-smoke")

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
            f"OpenCode Go model {model!r} is unavailable; set VISION_MODEL "
            "to an installed image-capable model.",
            pytrace=False,
        )
    image_inputs = ((selected.get("modalities") or {}).get("input") or [])
    if not any(str(item).startswith("image/") for item in image_inputs):
        pytest.fail(f"OpenCode Go model {model!r} does not accept image input", pytrace=False)

    frame = tmp_path / "testsrc2.png"
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=1",
            "-frames:v",
            "1",
            str(frame),
        ],
        check=True,
        capture_output=True,
    )

    provider = OpenAICompatibleVisionProvider(
        base_url=base_url,
        api_key=api_key,
        model=model,
        session_id=session_id,
        timeout=120.0,
    )
    observation = provider.analyze(
        frame.read_bytes(),
        {
            "timestampSec": 0,
            "detailLevel": "MEDIUM",
            "sourceName": "opencode-go-smoke.png",
            "durationSec": 1,
        },
    )

    assert observation["certainty"] in {"OBSERVED", "INFERRED", "UNCERTAIN"}
    assert observation["sceneTitle"] or observation["visualDescription"]
    assert isinstance(observation["uiElements"], list)
    assert isinstance(observation["visibleText"], list)
    assert isinstance(observation["interactions"], list)

    ui_image = tmp_path / "checkout-reference.png"
    _draw_ui_image(ui_image)
    settings = Settings(
        transcription_provider="none",
        vision_provider="openai_compatible",
        vision_model=model,
        openai_api_key=api_key,
        openai_base_url=base_url,
        opencode_session_id=session_id,
        ocr_provider="vision",
        text_provider="template",
    )
    markdown, payload = analyze_file(ui_image, settings)
    visible_text = [
        item if isinstance(item, str) else str(item.get("text") or "")
        for item in payload.get("visibleText", [])
    ]
    combined_text = " ".join(
        [
            *visible_text,
            *payload.get("uiHierarchy", []),
            *(finding.get("text", "") for finding in payload.get("visualFindings", [])),
        ]
    )
    expected_terms = ["checkout", "1042", "42", "pay now", "4242"]
    assert sum(term in combined_text.lower() for term in expected_terms) >= 2
    assert payload["source"]["kind"] == "image"
    assert payload["evidence"]
    assert "**Source type:** Still image" in markdown
