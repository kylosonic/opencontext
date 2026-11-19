"""Real FFmpeg normalization checks for image safety and orientation."""

from pathlib import Path

from PIL import Image

from oc_worker.ffmpeg import extract_image_frame


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
