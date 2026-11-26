"""Local Tesseract OCR provider using its tab-separated output."""

from __future__ import annotations

import csv
import io
import re
from collections import OrderedDict
from dataclasses import replace
from typing import Any

from oc_worker.errors import PermanentFailure, ProviderConfigurationError, TransientFailure
from oc_worker.process_sandbox import (
    TESSERACT_LIMITS,
    SandboxTimeout,
    resolve_executable,
    run_sandboxed,
)

_LANGUAGE_RE = re.compile(r"^[A-Za-z0-9_+.-]{1,64}$")


def parse_tesseract_tsv(output: str) -> list[dict[str, Any]]:
    """Group recognized words into lines with average confidence."""
    reader = csv.DictReader(
        io.StringIO(output),
        delimiter="\t",
        quoting=csv.QUOTE_NONE,
    )
    lines: OrderedDict[tuple[str, ...], dict[str, Any]] = OrderedDict()
    for row in reader:
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            confidence = max(0.0, min(1.0, float(row.get("conf") or -1) / 100))
        except ValueError:
            confidence = 0.0
        key = tuple(
            row.get(part) or ""
            for part in ("page_num", "block_num", "par_num", "line_num")
        )
        entry = lines.setdefault(key, {"words": [], "confidence": []})
        entry["words"].append(text)
        entry["confidence"].append(confidence)

    results: list[dict[str, Any]] = []
    for entry in lines.values():
        text = " ".join(entry["words"]).strip()
        if not text:
            continue
        confidence = entry["confidence"]
        results.append(
            {
                "text": text,
                "confidence": round(sum(confidence) / len(confidence), 4),
            }
        )
    return results


class TesseractOcrProvider:
    name = "tesseract"

    def __init__(
        self,
        executable: str = "tesseract",
        language: str = "eng",
        timeout_seconds: int = 30,
    ) -> None:
        self.executable = executable
        if not _LANGUAGE_RE.fullmatch(language):
            raise ProviderConfigurationError(
                "OCR_LANGUAGE may contain only letters, numbers, _, +, ., or -"
            )
        self.language = language
        self.timeout_seconds = timeout_seconds

    def extract(
        self,
        frame_bytes: bytes,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        del context
        try:
            executable = resolve_executable(self.executable)
            proc = run_sandboxed(
                [
                    str(executable),
                    "stdin",
                    "stdout",
                    "-l",
                    self.language,
                    "--psm",
                    "6",
                    "tsv",
                ],
                limits=replace(TESSERACT_LIMITS, timeout_seconds=self.timeout_seconds),
                input_data=frame_bytes,
            )
        except FileNotFoundError as exc:
            raise PermanentFailure(
                f"Tesseract executable not found: {self.executable}"
            ) from exc
        except SandboxTimeout as exc:
            raise TransientFailure("Tesseract OCR timed out") from exc
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", errors="replace").strip()[-300:]
            raise TransientFailure(f"Tesseract OCR failed: {detail}")
        return parse_tesseract_tsv(proc.stdout.decode("utf-8", errors="replace"))
