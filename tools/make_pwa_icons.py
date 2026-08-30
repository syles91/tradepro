#!/usr/bin/env python3
"""Erzeugt die PWA-Icons für TradePro (static/icons/).

Aufruf:  /opt/hermes/.venv/bin/python tools/make_pwa_icons.py
Erzeugt maskable-taugliche Icons (Motiv innerhalb der 80%-Safe-Zone) in allen
von Android/Chrome benötigten Größen plus ein Apple-Touch-Icon.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ICON_DIR = Path(__file__).resolve().parent.parent / "static" / "icons"
SIZES = (72, 96, 128, 144, 152, 180, 192, 256, 384, 512)

BG = (11, 14, 17, 255)        # --bg
PANEL = (19, 23, 34, 255)     # --bg2
GREEN = (46, 189, 158, 255)   # --green-br
RED = (239, 83, 80, 255)      # --red
BLUE = (41, 98, 255, 255)     # --blue


def _candle(d: ImageDraw.ImageDraw, cx: float, top: float, bottom: float,
            body_top: float, body_bottom: float, w: float, color) -> None:
    d.rectangle([cx - w * 0.09, top, cx + w * 0.09, bottom], fill=color)
    d.rounded_rectangle(
        [cx - w / 2, body_top, cx + w / 2, body_bottom],
        radius=max(1, w * 0.18), fill=color,
    )


def build(size: int) -> Image.Image:
    """Zeichnet das Icon in 4x-Auflösung und skaliert für saubere Kanten herunter."""
    s = size * 4
    img = Image.new("RGBA", (s, s), BG)
    d = ImageDraw.Draw(img)

    # Abgerundeter Panel-Hintergrund innerhalb der maskable Safe-Zone (80 %).
    pad = s * 0.10
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.16, fill=PANEL)

    inner = s - 2 * pad
    cw = inner * 0.15          # Kerzenbreite

    # Drei Kerzen: rot (down), grün (up), grün (up, höher) -> Aufwärtstrend.
    _candle(d, pad + inner * 0.26, pad + inner * 0.26, pad + inner * 0.74,
            pad + inner * 0.34, pad + inner * 0.62, cw, RED)
    _candle(d, pad + inner * 0.50, pad + inner * 0.18, pad + inner * 0.82,
            pad + inner * 0.30, pad + inner * 0.70, cw, GREEN)
    _candle(d, pad + inner * 0.74, pad + inner * 0.12, pad + inner * 0.66,
            pad + inner * 0.20, pad + inner * 0.56, cw, GREEN)

    # Trendlinie über den Kerzen.
    d.line(
        [(pad + inner * 0.18, pad + inner * 0.60),
         (pad + inner * 0.42, pad + inner * 0.44),
         (pad + inner * 0.62, pad + inner * 0.50),
         (pad + inner * 0.86, pad + inner * 0.24)],
        fill=BLUE, width=max(2, int(s * 0.028)), joint="curve",
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for size in SIZES:
        img = build(size)
        path = ICON_DIR / f"icon-{size}.png"
        img.save(path, "PNG", optimize=True)
        written.append(path.name)
    # Apple-Touch-Icon (iOS erwartet 180x180 ohne Transparenz).
    build(180).convert("RGB").save(ICON_DIR / "apple-touch-icon.png", "PNG", optimize=True)
    written.append("apple-touch-icon.png")
    print(f"{len(written)} Icons geschrieben nach {ICON_DIR}:")
    for name in written:
        print("  -", name)


if __name__ == "__main__":
    main()
