from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SOURCE_LOGO = ROOT / ".github" / "assets" / "ema-logo-min.jpg"
DARK_LOGO = ROOT / ".github" / "assets" / "ema-logo-dark.png"
LIGHT_LOGO = ROOT / ".github" / "assets" / "ema-logo-light.png"
README = ROOT / "README.md"

DARK_BACKGROUND = (0x0D, 0x11, 0x17)
DARK_FOREGROUND = (0xF0, 0xF6, 0xFC)
LIGHT_BACKGROUND = (0xFF, 0xFF, 0xFF)
LIGHT_FOREGROUND = (0x00, 0x00, 0x00)

LOGO_BLOCK_PATTERN = re.compile(
    r'\A<p align="center">\n'
    r'  <img src="\.github/assets/ema-logo-min\.jpg" alt="EMA Logo" width="200">\n'
    r"</p>"
)

README_LOGO_BLOCK = """<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/ema-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/ema-logo-light.png">
    <img alt="Project Logo" src=".github/assets/ema-logo-light.png" width="200">
  </picture>
</p>"""


def render_logo(background: tuple[int, int, int], foreground: tuple[int, int, int]) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(SOURCE_LOGO)).convert("L")

    # The source is a white-on-black JPEG. Clamp near-black/near-white values so
    # the requested flat colors remain exact away from anti-aliased edges.
    alpha = source.point(
        lambda pixel: 0
        if pixel <= 8
        else 255
        if pixel >= 250
        else round((pixel - 8) * 255 / (250 - 8))
    )

    bg = Image.new("RGB", source.size, background)
    fg = Image.new("RGB", source.size, foreground)
    return Image.composite(fg, bg, alpha)


def update_readme() -> None:
    readme = README.read_text(encoding="utf-8")
    if README_LOGO_BLOCK in readme:
        return

    updated, replacements = LOGO_BLOCK_PATTERN.subn(README_LOGO_BLOCK, readme, count=1)
    if replacements != 1:
        raise RuntimeError("Could not find the README logo block to replace.")

    README.write_text(updated, encoding="utf-8")


def main() -> None:
    render_logo(DARK_BACKGROUND, DARK_FOREGROUND).save(DARK_LOGO, optimize=True)
    render_logo(LIGHT_BACKGROUND, LIGHT_FOREGROUND).save(LIGHT_LOGO, optimize=True)
    update_readme()


if __name__ == "__main__":
    main()
