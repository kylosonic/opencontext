"""PDF rendering contract tests."""

from pathlib import Path

import pytest
from PIL import Image, ImageDraw

import oc_worker.pdf as pdf_module
from oc_worker.errors import PermanentFailure
from oc_worker.pdf import extract_pdf_pages


def test_extract_pdf_pages_renders_ordered_jpegs(tmp_path: Path) -> None:
    pdf_path = tmp_path / "reference.pdf"
    pages = []
    for index in range(2):
        page = Image.new("RGB", (320, 240), "white")
        draw = ImageDraw.Draw(page)
        draw.text((20, 20), f"Page {index + 1}", fill="black")
        pages.append(page)
    pages[0].save(pdf_path, save_all=True, append_images=pages[1:])

    rendered = extract_pdf_pages(pdf_path, tmp_path / "pages", max_width=640)

    assert [page["pageNumber"] for page in rendered] == [1, 2]
    assert all(Path(page["path"]).is_file() for page in rendered)
    assert all(Path(page["path"]).read_bytes().startswith(b"\xff\xd8") for page in rendered)


def test_extract_pdf_pages_enforces_the_page_limit(tmp_path: Path) -> None:
    pdf_path = tmp_path / "too-long.pdf"
    pages = [Image.new("RGB", (80, 60), "white") for _ in range(3)]
    pages[0].save(pdf_path, save_all=True, append_images=pages[1:])

    with pytest.raises(PermanentFailure, match="limit is 2"):
        extract_pdf_pages(pdf_path, tmp_path / "pages", max_pages=2)


def test_extract_pdf_pages_bounds_both_dimensions_and_pixels(
    tmp_path: Path, monkeypatch,
) -> None:
    observed_scales: list[float] = []

    class Bitmap:
        def __init__(self, scale: float) -> None:
            self.scale = scale

        def to_pil(self):
            return Image.new("RGBA", (1000, 1000), "white")

        def close(self) -> None:
            return None

    class TextPage:
        def get_text_range(self) -> str:
            return "bounded"

        def close(self) -> None:
            return None

    class Page:
        def get_size(self):
            return (200_000, 200_000)

        def render(self, *, scale: float):
            observed_scales.append(scale)
            return Bitmap(scale)

        def get_textpage(self):
            return TextPage()

        def close(self) -> None:
            return None

    class Document:
        def __init__(self, _path: str) -> None:
            self.page = Page()

        def __len__(self) -> int:
            return 1

        def __getitem__(self, _index: int):
            return self.page

        def close(self) -> None:
            return None

    monkeypatch.setattr(pdf_module.pdfium, "PdfDocument", Document)
    rendered = extract_pdf_pages(
        tmp_path / "huge.pdf",
        tmp_path / "pages",
        max_width=10_000,
        max_page_pixels=1_000_000,
    )

    assert len(rendered) == 1
    assert observed_scales == [0.005]
