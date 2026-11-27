"""Generates the application icon (PNG + ICO) into resources/ and src/renderer/public/.

Usage: python scripts/make-icon.py
Requires: Pillow (pip install pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE = 512
COLOR_FROM = (76, 154, 255)
COLOR_TO = (47, 200, 160)


def build_image() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x / SIZE) * 0.55 + (y / SIZE) * 0.45
            pixels[x, y] = (
                int(COLOR_FROM[0] + (COLOR_TO[0] - COLOR_FROM[0]) * t),
                int(COLOR_FROM[1] + (COLOR_TO[1] - COLOR_FROM[1]) * t),
                int(COLOR_FROM[2] + (COLOR_TO[2] - COLOR_FROM[2]) * t),
                255,
            )

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=110, fill=255)
    image.putalpha(mask)

    draw = ImageDraw.Draw(image)
    white = (255, 255, 255, 255)
    width = 44
    draw.line([(140, 150), (372, 150)], fill=white, width=width)
    draw.line([(372, 150), (140, 370)], fill=white, width=width)
    draw.line([(140, 370), (372, 370)], fill=white, width=width)
    draw.ellipse([300, 300, 340, 340], outline=white, width=10)
    draw.line([(340, 320), (400, 320)], fill=white, width=10)
    draw.ellipse([392, 312, 408, 328], fill=(255, 255, 255, 235))
    return image


def main() -> None:
    image = build_image()
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]

    resources = ROOT / "resources"
    public = ROOT / "src" / "renderer" / "public"
    resources.mkdir(parents=True, exist_ok=True)
    public.mkdir(parents=True, exist_ok=True)

    image.save(resources / "icon.ico", sizes=sizes)
    image.save(public / "icon.ico", sizes=sizes)
    image.save(public / "icon.png")
    print(f"icon written to {resources / 'icon.ico'} and {public / 'icon.ico'}")


if __name__ == "__main__":
    main()
