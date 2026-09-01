"""
Rendert die Liquidation-Heatmap aus echten Live-Daten als PNG — dieselbe
Rechenlogik und Palette wie der Browser-Renderer, nur ohne Browser.
Dient als visueller Beleg fuer die Darstellung.
"""
import asyncio
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tradepro.market.liquidations import liquidation_heatmap  # noqa: E402

PALETTE = [(4, 2, 15), (26, 11, 64), (59, 15, 112), (111, 26, 129),
           (140, 41, 129), (190, 62, 108), (222, 73, 104),
           (246, 110, 92), (254, 159, 109), (252, 253, 191)]


def heat_color(t):
    t = max(0.0, min(1.0, t))
    n = len(PALETTE) - 1
    i = min(int(t * n), n - 1)
    f = t * n - i
    a, b = PALETTE[i], PALETTE[i + 1]
    return tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3))


def write_png(path, pix, w, h):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pix)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    Path(path).write_bytes(png)


def render(d, out, W=900, H=520):
    cols = len(d["matrix"])
    rows = d["priceBins"]
    lo, hi = d["low"], d["high"]
    span = (hi - lo) or 1
    maxv = d["maxValue"] or 1
    pix = [[(13, 5, 24)] * W for _ in range(H)]

    for px in range(W):
        x = min(int(px / W * cols), cols - 1)
        col = d["matrix"][x]
        for py in range(H):
            y = min(int((1 - py / H) * rows), rows - 1)
            v = col[y]
            if v > 0:
                pix[py][px] = heat_color((v / maxv) ** 0.5)

    def yof(p):
        return int((1 - (p - lo) / span) * (H - 1))

    for i, c in enumerate(d["candles"]):
        xc = int((i + 0.5) / cols * W)
        color = (46, 189, 158) if c["close"] >= c["open"] else (240, 97, 106)
        for py in range(max(0, yof(c["high"])), min(H, yof(c["low"]) + 1)):
            if 0 <= xc < W:
                pix[py][xc] = color
        y1, y2 = sorted((yof(c["open"]), yof(c["close"])))
        for py in range(max(0, y1), min(H, y2 + 1)):
            for dx in range(-2, 3):
                if 0 <= xc + dx < W:
                    pix[py][xc + dx] = color

    write_png(out, pix, W, H)


d = asyncio.run(liquidation_heatmap("BTCUSDT", "binance", "1d", 100))
out = "/opt/data/crypto-dashboard/data/heatmap_preview.png"
render(d, out)
print(f"{out}\n{len(d['matrix'])}x{d['priceBins']} | Preis {d['price']:.0f} | "
      f"Range {d['low']:.0f}-{d['high']:.0f} | Peak {d['maxValue']/1e6:.1f}M")
