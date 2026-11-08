"""OCR provider implementations."""

from oc_worker.providers.ocr.base import OcrProvider
from oc_worker.providers.ocr.fixture import FixtureOcrProvider
from oc_worker.providers.ocr.tesseract import TesseractOcrProvider

__all__ = ["FixtureOcrProvider", "OcrProvider", "TesseractOcrProvider"]
