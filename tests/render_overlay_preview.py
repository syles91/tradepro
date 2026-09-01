"""
Rendert die Liquidation-Heatmap als Chart-OVERLAY (Kerzen im Vordergrund,
Heatmap additiv dahinter) aus echten Live-Daten — gleiche Alpha- und
Blend-Logik wie der Browser-Renderer. Visueller Beleg fuer den Indikator.
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
BG = (11, 14, 17)      # Chart-Hintergrund #0b0e11
GRID = (28, 33, 48)    # Gitterfarbe #1c2130


def heat_color(t):
    t = max(0.0, min(1.0, t))
    n = len(PALETTE) - 1
    i = min(int(t * n), n - 1)
    f = t * n - i
    a, b = PALETTE[i], PALETTE[i + 1]
    return tuple(a[k] + (b[k] - a[k]) * f for k in range(3))


def write_png(path, pix, w, h):
    raw = b"".join(b"\x00" + bytes(int(v) for px in row for v in px) for row in pix)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    Path(path).write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b""))


def render(d, out, W=980, H=560):
    cols, rows = len(d["matrix"]), d["priceBins"]
    lo, hi = d["low"], d["high"]
    span = (hi - lo) or 1
    maxv = d["maxValue"] or 1
    pix = [[list(BG) for _ in range(W)] for _ in range(H)]

    for gy in range(0, H, H // 8):
        for x in range(W):
            pix[gy][x] = list(GRID)
    for gx in range(0, W, W // 10):
        for y in range(H):
            pix[y][gx] = list(GRID)

    # Heatmap additiv darueberblenden — wie ctx.globalCompositeOperation='lighter'
    for px in range(W):
        x = min(int(px / W * cols), cols - 1)
        col = d["matrix"][x]
        for py in range(H):
            y = min(int((1 - py / H) * rows), rows - 1)
            v = col[y]
            if v <= 0:
                continue
            t = (v / maxv) ** 0.5
            alpha = 0.18 + t * 0.5
            c = heat_color(t)
            dst = pix[py][px]
            for k in range(3):
                dst[k] = min(255, dst[k] + c[k] * alpha)

    def yof(p):
        return max(0, min(H - 1, int((1 - (p - lo) / span) * (H - 1))))

    for i, c in enumerate(d["candles"]):
        xc = int((i + 0.5) / cols * W)
        color = (46, 189, 158) if c["close"] >= c["open"] else (240, 97, 106)
        for py in range(yof(c["high"]), yof(c["low"]) + 1):
            if 0 <= xc < W:
                pix[py][xc] = list(color)
        y1, y2 = sorted((yof(c["open"]), yof(c["close"])))
        for py in range(y1, y2 + 1):
            for dx in range(-3, 4):
                if 0 <= xc + dx < W:
                    pix[py][xc + dx] = list(color)

    write_png(out, pix, W, H)


sym = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
d = asyncio.run(liquidation_heatmap(sym, "binance", "3d", 120, threshold=0.12))
out = "/opt/data/crypto-dashboard/data/chart_overlay_preview.png"
render(d, out)
print(f"{out}\n{sym} | {len(d['matrix'])}x{d['priceBins']} | Preis {d['price']:.0f} | "
      f"Range {d['low']:.0f}-{d['high']:.0f} | Peak {d['maxValue']/1e6:.1f}M")
