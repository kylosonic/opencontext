"""Subprocess entry point for PDFium rendering under resource limits."""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence

from oc_worker.errors import PermanentFailure
from oc_worker.pdf import _PDF_RESULT_PREFIX, _render_pdf_stream


def _write_result(payload: dict[str, object]) -> None:
    print(_PDF_RESULT_PREFIX + json.dumps(payload, separators=(",", ":")), flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-fd", type=int, required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-pages", type=int, required=True)
    parser.add_argument("--max-width", type=int, required=True)
    parser.add_argument("--max-height", type=int, required=True)
    parser.add_argument("--max-page-pixels", type=int, required=True)
    args = parser.parse_args(argv)

    try:
        with os.fdopen(args.input_fd, "rb", closefd=True) as stream:
            pages = _render_pdf_stream(
                stream,
                args.output_dir,
                max_pages=args.max_pages,
                max_width=args.max_width,
                max_height=args.max_height,
                max_page_pixels=args.max_page_pixels,
            )
        _write_result(
            {
                "ok": True,
                "pages": [
                    {
                        "pageNumber": page["pageNumber"],
                        "path": str(page["path"]),
                        "text": page["text"],
                    }
                    for page in pages
                ],
            }
        )
        return 0
    except PermanentFailure as exc:
        _write_result({"ok": False, "kind": "permanent", "error": str(exc)})
        return 2
    except BaseException:  # noqa: BLE001 - never expose parser internals to the worker
        _write_result({"ok": False, "kind": "internal", "error": "PDF renderer failed"})
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
