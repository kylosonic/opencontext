"""Real FFmpeg normalization checks for image safety and orientation."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageOps, ImageStat

from oc_worker.errors import PermanentFailure
from oc_worker.ffmpeg import extract_image_frame


def _quadrant_image() -> Image.Image:
    image = Image.new("RGB", (80, 40), (245, 245, 245))
    image.paste((220, 20, 20), (0, 0, 20, 20))
    image.paste((20, 180, 40), (60, 0, 20, 20))
    image.paste((20, 40, 220), (0, 20, 20, 20))
    image.paste((235, 210, 20), (60, 20, 20, 20))
    return image


def _mean_absolute_error(left: Image.Image, right: Image.Image) -> float:
    difference = ImageChops.difference(left.convert("RGB"), right.convert("RGB"))
    return sum(ImageStat.Stat(difference).mean) / 3


def test_transparency_is_flattened_to_white(tmp_path: Path) -> None:
    source = tmp_path / "transparent.png"
    image = Image.new("RGBA", (120, 80), (255, 0, 0, 0))
    image.putpixel((60, 40), (0, 0, 255, 255))
    image.save(source)
    output = tmp_path / "normalized.jpg"

    extract_image_frame(source, output)

    normalized = Image.open(output)
    assert normalized.mode == "RGB"
    assert all(channel >= 250 for channel in normalized.getpixel((0, 0)))


def test_opaque_colours_are_preserved_not_inverted(tmp_path: Path) -> None:
    source = tmp_path / "opaque-colours.png"
    image = Image.new("RGBA", (30, 10))
    expected = [(0, 0, 0), (255, 255, 255), (32, 96, 224)]
    for index, colour in enumerate(expected):
        image.paste((*colour, 255), (index * 10, 0, (index + 1) * 10, 10))
    image.save(source)
    output = tmp_path / "opaque-colours.jpg"

    extract_image_frame(source, output, max_width=30)

    normalized = Image.open(output).convert("RGB")
    actual = [normalized.getpixel((index * 10 + 5, 5)) for index in range(3)]
    for got, want in zip(actual, expected, strict=True):
        # JPEG is lossy; the old alpha bug shifts values by hundreds of levels.
        assert all(abs(got[channel] - want[channel]) <= 8 for channel in range(3))


@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WebP"])
def test_supported_formats_match_the_pillow_oracle(
    tmp_path: Path, image_format: str
) -> None:
    source = tmp_path / f"source.{image_format.lower()}"
    output = tmp_path / "normalized.jpg"
    _quadrant_image().save(source, format=image_format, quality=95)
    with Image.open(source) as original:
        oracle = ImageOps.exif_transpose(original.convert("RGB"))

    extract_image_frame(source, output, max_width=1280)

    with Image.open(output) as normalized:
        assert normalized.mode == "RGB"
        assert normalized.size == oracle.size
        assert _mean_absolute_error(normalized, oracle) < 2.5


def test_exif_orientation_is_applied_once(tmp_path: Path) -> None:
    source = tmp_path / "phone-photo.jpg"
    image = Image.new("RGB", (80, 40), "white")
    image.paste((100, 0, 0), (0, 0, 12, 12))
    exif = Image.Exif()
    exif[274] = 6
    image.save(source, exif=exif)
    output = tmp_path / "oriented.jpg"

    extract_image_frame(source, output)

    normalized = Image.open(output)
    assert normalized.size == (40, 80)
    assert normalized.getexif().get(274) is None
    # Orientation 6 rotates the source clockwise: the top-left source marker
    # becomes a marker near the top-right of this portrait output.
    def darker_pixels(x: int, y: int) -> int:
        gray = normalized.crop((x, y, x + 12, y + 12)).convert("L")
        return sum(1 for value in gray.get_flattened_data() if value < 245)

    assert darker_pixels(28, 0) >= 4
    assert darker_pixels(0, 0) == 0
    assert darker_pixels(0, 68) == 0


@pytest.mark.parametrize("orientation", range(2, 9))
def test_all_exif_orientations_match_the_pillow_oracle(
    tmp_path: Path, orientation: int
) -> None:
    source = tmp_path / f"orientation-{orientation}.jpg"
    output = tmp_path / f"orientation-{orientation}-normalized.jpg"
    exif = Image.Exif()
    exif[274] = orientation
    _quadrant_image().save(source, exif=exif, quality=95)
    with Image.open(source) as original:
        oracle = ImageOps.exif_transpose(original.convert("RGB"))

    extract_image_frame(source, output)

    with Image.open(output) as normalized:
        assert normalized.size == oracle.size
        assert normalized.getexif().get(274) is None
        assert _mean_absolute_error(normalized, oracle) < 2.5


@pytest.mark.parametrize("image_format", ["PNG", "WebP"])
def test_translucent_pixels_are_composited_on_white(
    tmp_path: Path, image_format: str
) -> None:
    source = tmp_path / f"translucent.{image_format.lower()}"
    output = tmp_path / "translucent.jpg"
    image = Image.new("RGBA", (32, 32), (255, 0, 0, 128))
    image.save(source, format=image_format)

    extract_image_frame(source, output)

    with Image.open(output).convert("RGB") as normalized:
        pixel = normalized.getpixel((16, 16))
    # 50% red over white is approximately (255, 128, 128).
    assert abs(pixel[0] - 255) <= 4
    assert abs(pixel[1] - 128) <= 8
    assert abs(pixel[2] - 128) <= 8


@pytest.mark.parametrize(("size", "expected"), [((800, 400), (200, 100)), ((400, 800), (100, 200))])
def test_long_edge_is_bounded_without_changing_aspect_ratio(
    tmp_path: Path,
    size: tuple[int, int],
    expected: tuple[int, int],
) -> None:
    source = tmp_path / "large.png"
    output = tmp_path / "bounded.jpg"
    Image.new("RGB", size, (32, 96, 160)).save(source)

    extract_image_frame(source, output, max_width=200)

    with Image.open(output) as normalized:
        assert normalized.size == expected


def test_metadata_is_stripped_from_supported_formats(tmp_path: Path) -> None:
    exif = Image.Exif()
    exif[270] = "sensitive-image-description"
    for image_format, extension in (("PNG", "png"), ("JPEG", "jpg"), ("WebP", "webp")):
        source = tmp_path / f"metadata.{extension}"
        output = tmp_path / f"metadata-{extension}.jpg"
        _quadrant_image().save(
            source,
            format=image_format,
            exif=exif,
            comment=b"sensitive-comment",
        )

        extract_image_frame(source, output)

        with Image.open(output) as normalized:
            assert normalized.getexif() == Image.Exif()
            assert "exif" not in normalized.info
            assert "comment" not in normalized.info
            assert "xmp" not in normalized.info
            assert "sensitive" not in str(normalized.info)


def test_repeated_normalization_is_byte_deterministic(tmp_path: Path) -> None:
    source = tmp_path / "deterministic.png"
    first = tmp_path / "first.jpg"
    second = tmp_path / "second.jpg"
    _quadrant_image().save(source)

    extract_image_frame(source, first)
    extract_image_frame(source, second)

    assert hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(
        second.read_bytes()
    ).digest()


@pytest.mark.parametrize(
    ("name", "payload"),
    [
        ("empty.jpg", b""),
        ("random.png", b"not-a-png"),
        ("truncated.jpg", b"\xff\xd8\xff\xe0\x00\x10JFIF\x00"),
        ("truncated.webp", b"RIFF\x20\x00\x00\x00WEBPVP8 "),
    ],
)
def test_malformed_image_corpus_fails_without_partial_output(
    tmp_path: Path, name: str, payload: bytes
) -> None:
    source = tmp_path / name
    output = tmp_path / "normalized.jpg"
    source.write_bytes(payload)

    with pytest.raises(PermanentFailure, match="image conversion failed"):
        extract_image_frame(source, output)

    assert not output.exists()
