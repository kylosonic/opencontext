"""Opt-in real vision smoke test through the OpenCode Go API."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from oc_worker.providers.vision.openai_compatible import OpenAICompatibleVisionProvider

ENABLED = os.getenv("OPENCONTEXT_OPENCODE_E2E") == "1"
FFMPEG = shutil.which("ffmpeg")

pytestmark = pytest.mark.skipif(
    not ENABLED,
    reason="set OPENCONTEXT_OPENCODE_E2E=1 to run",
)


def test_real_opencode_vision_smoke(tmp_path: Path) -> None:
    api_key = os.getenv("OPENCODE_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        pytest.fail(
            "OPENCODE_API_KEY is required. Set it to a valid OpenCode Go API key.",
            pytrace=False,
        )
    if FFMPEG is None:
        pytest.fail("ffmpeg is required to generate the smoke-test frame", pytrace=False)

    base_url = os.getenv(
        "OPENAI_BASE_URL",
        "https://opencode.ai/inference/go/openai/v1",
    ).rstrip("/")
    model = os.getenv("VISION_MODEL", "glm-5.3-flash")
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
