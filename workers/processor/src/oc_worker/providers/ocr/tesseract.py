"""Local Tesseract OCR provider using its tab-separated output."""

from __future__ import annotations

import csv
import io
import subprocess
from collections import OrderedDict
from typing import Any

from oc_worker.errors import PermanentFailure, TransientFailure


def parse_tesseract_tsv(output: str) -> list[dict[str, Any]]:
    """Group recognized words into lines with average confidence."""
    reader = csv.DictReader(io.StringIO(output), delimiter="\t")
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
        self.language = language
        self.timeout_seconds = timeout_seconds

    def extract(
        self,
        frame_bytes: bytes,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        del context
        try:
            proc = subprocess.run(
                [
                    self.executable,
                    "stdin",
                    "stdout",
                    "-l",
                    self.language,
                    "--psm",
                    "6",
                    "tsv",
                ],
                input=frame_bytes,
                capture_output=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except FileNotFoundError as exc:
            raise PermanentFailure(
                f"Tesseract executable not found: {self.executable}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise TransientFailure("Tesseract OCR timed out") from exc
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", errors="replace").strip()[-300:]
            raise TransientFailure(f"Tesseract OCR failed: {detail}")
        return parse_tesseract_tsv(proc.stdout.decode("utf-8", errors="replace"))
