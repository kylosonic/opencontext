"""Opt-in smoke test for a real local Ollama vision model.

This proves provider setup and response parsing for one synthetic frame. It is
not a model-quality evaluation and is skipped unless explicitly enabled.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from oc_worker.providers.vision.ollama import OllamaVisionProvider

ENABLED = os.getenv("OPENCONTEXT_OLLAMA_E2E") == "1"
FFMPEG = shutil.which("ffmpeg")

pytestmark = [
    pytest.mark.skipif(not ENABLED, reason="set OPENCONTEXT_OLLAMA_E2E=1 to run"),
    pytest.mark.skipif(FFMPEG is None, reason="ffmpeg is required to generate a frame"),
]


def test_real_ollama_vision_smoke(tmp_path: Path) -> None:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = (
        os.getenv("OLLAMA_VISION_MODEL")
        or os.getenv("VISION_MODEL")
        or "qwen2.5vl:3b"
    )

    try:
        response = httpx.get(f"{base_url}/api/tags", timeout=5.0)
        response.raise_for_status()
        models = {
            str(item.get("name") or item.get("model"))
            for item in response.json().get("models", [])
        }
    except (httpx.HTTPError, ValueError) as exc:
        pytest.fail(
            f"Ollama is unavailable at {base_url}. Start it and retry: {exc}",
            pytrace=False,
        )

    if model not in models:
        pytest.fail(
            f"Ollama model {model!r} is not installed. Run `ollama pull {model}` "
            "or set OLLAMA_VISION_MODEL to an installed vision model.",
            pytrace=False,
        )

    frame = tmp_path / "testsrc2.png"
    assert FFMPEG is not None
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

    provider = OllamaVisionProvider(base_url=base_url, model=model, timeout=120.0)
    observation = provider.analyze(
        frame.read_bytes(),
        {
            "timestampSec": 0,
            "detailLevel": "MEDIUM",
            "sourceName": "ollama-smoke.png",
            "durationSec": 1,
        },
    )

    assert observation["certainty"] in {"OBSERVED", "INFERRED", "UNCERTAIN"}
    assert observation["sceneTitle"] or observation["visualDescription"]
    assert isinstance(observation["uiElements"], list)
    assert isinstance(observation["visibleText"], list)
