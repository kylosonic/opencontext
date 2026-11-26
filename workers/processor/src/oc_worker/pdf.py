"""Bounded PDF rendering in an isolated helper process."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any, BinaryIO

import pypdfium2 as pdfium
from PIL import Image

from oc_worker.errors import PermanentFailure, TransientFailure, check_abort
from oc_worker.process_sandbox import (
    INPUT_FD_PLACEHOLDER,
    PDF_LIMITS,
    SandboxTimeout,
    run_sandboxed,
)

MAX_PDF_PAGES = 30
DEFAULT_MAX_WIDTH = 1600
DEFAULT_MAX_HEIGHT = 4000
MAX_PDF_PAGE_PIXELS = 40_000_000
MAX_PDF_EMBEDDED_TEXT_CHARS = 2_000_000
MAX_PDF_OUTPUT_BYTES = 512 * 1024**2
_PDF_RESULT_PREFIX = "@@OPENCONTEXT_PDF@@"


def _render_pdf_stream(
    stream: BinaryIO,
    outdir: str | Path,
    *,
    max_pages: int = MAX_PDF_PAGES,
    max_width: int = DEFAULT_MAX_WIDTH,
    max_height: int = DEFAULT_MAX_HEIGHT,
    max_page_pixels: int = MAX_PDF_PAGE_PIXELS,
) -> list[dict[str, Any]]:
    """Render a PDF byte stream; called only inside the bounded helper."""
    directory = Path(outdir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    try:
        document = pdfium.PdfDocument(stream)
    except Exception as exc:  # noqa: BLE001 - PDFium reports varied load errors
        raise PermanentFailure("This file is not a valid PDF") from exc

    try:
        try:
            page_count = len(document)
        except Exception as exc:  # noqa: BLE001 - malformed PDF object graph
            raise PermanentFailure("This file is not a valid PDF") from exc
        if page_count == 0:
            raise PermanentFailure("This PDF has no pages")
        if max_pages < 1 or page_count > max_pages:
            raise PermanentFailure(
                f"PDF has {page_count} pages — the limit is {max_pages}"
            )

        pages: list[dict[str, Any]] = []
        embedded_text_chars = 0
        output_bytes = 0
        for index in range(page_count):
            check_abort()
            try:
                page = document[index]
            except Exception as exc:  # noqa: BLE001 - malformed page tree
                raise PermanentFailure(
                    f"Could not load PDF page {index + 1}"
                ) from exc
            try:
                width, height = (float(value) for value in page.get_size())
                if (
                    not math.isfinite(width)
                    or not math.isfinite(height)
                    or width <= 0
                    or height <= 0
                ):
                    raise PermanentFailure(f"PDF page {index + 1} has invalid dimensions")
                pixel_scale = math.sqrt(max_page_pixels / (width * height))
                scale = min(
                    3.0,
                    max_width / width,
                    max_height / height,
                    pixel_scale,
                )
                if scale <= 0:
                    raise PermanentFailure(f"PDF page {index + 1} is too large to render")
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil().convert("RGBA")
                    if image.width * image.height > max_page_pixels:
                        raise PermanentFailure(
                            f"PDF page {index + 1} exceeds the 40-megapixel limit"
                        )
                    background = Image.new("RGB", image.size, "white")
                    background.paste(image, mask=image.getchannel("A"))
                    output = directory / f"page_{index + 1:03d}.jpg"
                    background.save(output, format="JPEG", quality=88, optimize=True)
                    output_bytes += output.stat().st_size
                    if output_bytes > MAX_PDF_OUTPUT_BYTES:
                        raise PermanentFailure("Rendered PDF pages exceed the output limit")
                finally:
                    bitmap.close()

                text = ""
                text_page = page.get_textpage()
                try:
                    text = str(text_page.get_text_range() or "").strip()
                finally:
                    text_page.close()
                embedded_text_chars += len(text)
                if embedded_text_chars > MAX_PDF_EMBEDDED_TEXT_CHARS:
                    raise PermanentFailure("PDF embedded text exceeds the output limit")
                pages.append(
                    {
                        "pageNumber": index + 1,
                        "path": output,
                        "text": text,
                    }
                )
            except PermanentFailure:
                raise
            except Exception as exc:
                raise PermanentFailure(f"Could not render PDF page {index + 1}") from exc
            finally:
                page.close()
        return pages
    finally:
        document.close()


def _parse_helper_result(stdout: str) -> dict[str, Any] | None:
    for line in reversed(stdout.splitlines()):
        if not line.startswith(_PDF_RESULT_PREFIX):
            continue
        try:
            payload = json.loads(line.removeprefix(_PDF_RESULT_PREFIX))
        except ValueError:
            return None
        return payload if isinstance(payload, dict) else None
    return None


def _cleanup_pages(directory: Path) -> None:
    for output in directory.glob("page_*.jpg"):
        output.unlink(missing_ok=True)


def extract_pdf_pages(
    src: str | Path,
    outdir: str | Path,
    *,
    max_pages: int = MAX_PDF_PAGES,
    max_width: int = DEFAULT_MAX_WIDTH,
    max_height: int = DEFAULT_MAX_HEIGHT,
    max_page_pixels: int = MAX_PDF_PAGE_PIXELS,
) -> list[dict[str, Any]]:
    """Render a bounded PDF in a resource-limited child process."""
    source = Path(src).resolve()
    directory = Path(outdir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    _cleanup_pages(directory)
    command = [
        sys.executable,
        "-m",
        "oc_worker.pdf_worker",
        "--input-fd",
        INPUT_FD_PLACEHOLDER,
        "--output-dir",
        str(directory),
        "--max-pages",
        str(max_pages),
        "--max-width",
        str(max_width),
        "--max-height",
        str(max_height),
        "--max-page-pixels",
        str(max_page_pixels),
    ]
    try:
        result = run_sandboxed(
            command,
            limits=PDF_LIMITS,
            input_path=source,
            text=True,
        )
    except FileNotFoundError as exc:
        raise PermanentFailure("This file is not a valid PDF") from exc
    except SandboxTimeout as exc:
        raise TransientFailure("PDF rendering timed out") from exc

    payload = _parse_helper_result(str(result.stdout or ""))
    if result.returncode != 0 or payload is None or not payload.get("ok"):
        _cleanup_pages(directory)
        if payload is not None and payload.get("kind") == "permanent":
            error = str(payload.get("error") or "This file is not a valid PDF")
            raise PermanentFailure(error[:500])
        raise TransientFailure("PDF renderer failed")
    raw_pages = payload.get("pages")
    if not isinstance(raw_pages, list):
        _cleanup_pages(directory)
        raise TransientFailure("PDF renderer returned an invalid response")

    pages: list[dict[str, Any]] = []
    try:
        for item in raw_pages:
            if not isinstance(item, dict):
                raise ValueError
            output = Path(str(item["path"])).resolve()
            if not output.is_relative_to(directory) or not output.is_file():
                raise ValueError
            page_number = int(item["pageNumber"])
            pages.append(
                {
                    "pageNumber": page_number,
                    "path": output,
                    "text": str(item.get("text") or ""),
                }
            )
    except (KeyError, TypeError, ValueError) as exc:
        _cleanup_pages(directory)
        raise TransientFailure("PDF renderer returned an invalid response") from exc
    return pages
