"""PDF page rendering and embedded-text extraction for the media pipeline."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from PIL import Image

from oc_worker.errors import PermanentFailure, check_abort

MAX_PDF_PAGES = 30
DEFAULT_MAX_WIDTH = 1600
DEFAULT_MAX_HEIGHT = 4000
MAX_PDF_PAGE_PIXELS = 40_000_000


def extract_pdf_pages(
    src: str | Path,
    outdir: str | Path,
    *,
    max_pages: int = MAX_PDF_PAGES,
    max_width: int = DEFAULT_MAX_WIDTH,
    max_height: int = DEFAULT_MAX_HEIGHT,
    max_page_pixels: int = MAX_PDF_PAGE_PIXELS,
) -> list[dict[str, Any]]:
    """Render a bounded PDF to ordered JPEG pages and extract embedded text."""
    directory = Path(outdir)
    directory.mkdir(parents=True, exist_ok=True)
    try:
        document = pdfium.PdfDocument(str(src))
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
                finally:
                    bitmap.close()

                text = ""
                text_page = page.get_textpage()
                try:
                    text = str(text_page.get_text_range() or "").strip()
                finally:
                    text_page.close()
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
