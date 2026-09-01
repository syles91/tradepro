"""
Tests der Liquidation-Map-Rechenlogik (_build_map) — ohne Netzwerk.

Ausfuehren:  /opt/hermes/.venv/bin/python tests/test_liquidation_map.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tradepro.market.liquidations import (  # noqa: E402
    _Kline, _build_map, LEVERAGE_TIERS, MMR, WINDOWS,
)

ok = True


def chk(name, cond, extra=""):
    global ok
    print(("PASS" if cond else "FAIL") + " - " + name + ("" if cond or not extra else f"   [{extra}]"))
    if not cond:
        ok = False


def mk_klines(n=50, base=100.0, vol=10.0, buy_ratio=0.5, step=60):
    return [_Kline(time=1_700_000_000 + i * step, close=base, high=base * 1.002,
                   low=base * 0.998, volume=vol, taker_buy=vol * buy_ratio)
            for i in range(n)]


print("── Grundverhalten ──")
d = _build_map(mk_klines(), price=100.0, oi_usd=1_000_000.0, bins=60)
chk("liefert Level", len(d["levels"]) > 0, str(len(d["levels"])))
chk("Preis wird durchgereicht", d["price"] == 100.0)
chk("Tiers vollstaendig", len(d["tiers"]) == len(LEVERAGE_TIERS))

print("── Normierung auf Open Interest ──")
total = sum(l["total"] for l in d["levels"])
chk("Summe ≈ OI (Normierung greift)", abs(total - 1_000_000.0) < 1.0,
    f"{total:.2f} statt 1000000")

d0 = _build_map(mk_klines(), price=100.0, oi_usd=0.0, bins=60)
chk("ohne OI trotzdem Level (keine Division durch 0)", len(d0["levels"]) > 0)

print("── Seiten-Logik ──")
below = [l for l in d["levels"] if l["price"] < 100.0]
above = [l for l in d["levels"] if l["price"] > 100.0]
chk("Level unterhalb des Preises existieren", len(below) > 0)
chk("Level oberhalb des Preises existieren", len(above) > 0)
chk("unterhalb dominieren Longs",
    all(l["longUsd"] >= l["shortUsd"] for l in below))
chk("oberhalb dominieren Shorts",
    all(l["shortUsd"] >= l["longUsd"] for l in above))
chk("kein Level exakt auf dem Preis mit beiden Seiten > 0",
    all(not (l["longUsd"] > 0 and l["shortUsd"] > 0) for l in d["levels"]))

print("── Leverage-Distanzen ──")
# 100x-Level muessen naeher am Preis liegen als 10x-Level.
def nearest_for(lev):
    pool = [l for l in d["levels"] if str(lev) in l["byLeverage"]]
    return min(abs(l["price"] - 100.0) for l in pool) if pool else None

n100, n10 = nearest_for(100), nearest_for(10)
chk("100x-Level naeher am Preis als 10x", n100 is not None and n10 is not None and n100 < n10,
    f"100x={n100} 10x={n10}")

# Analytisch: 10x-Long liquidiert bei ~ P*(1-0.1+MMR)
expect_10x_long = 100.0 * (1 - 1 / 10 + MMR)
got = min((l["price"] for l in below if "10" in l["byLeverage"]),
          key=lambda p: abs(p - expect_10x_long), default=None)
chk("10x-Long-Level nahe analytischem Wert",
    got is not None and abs(got - expect_10x_long) < 1.0,
    f"erwartet ~{expect_10x_long:.2f}, gefunden {got}")

print("── Taker-Delta-Einfluss ──")
d_long = _build_map(mk_klines(buy_ratio=0.9), 100.0, 1e6, 60)
d_short = _build_map(mk_klines(buy_ratio=0.1), 100.0, 1e6, 60)
long_heavy = sum(l["longUsd"] for l in d_long["levels"])
long_light = sum(l["longUsd"] for l in d_short["levels"])
chk("hoher Taker-Buy-Anteil => mehr Long-Liquiditaet", long_heavy > long_light,
    f"{long_heavy:.0f} vs {long_light:.0f}")

print("── Kumulative Kurven ──")
below_sorted = sorted([l for l in d["levels"] if l["price"] < 100.0],
                      key=lambda l: -l["price"])
cums = [l["cumulative"] for l in below_sorted]
chk("Kumulative steigt vom Preis abwaerts monoton",
    all(cums[i] <= cums[i + 1] + 1e-6 for i in range(len(cums) - 1)))
above_sorted = sorted([l for l in d["levels"] if l["price"] >= 100.0],
                      key=lambda l: l["price"])
cums_a = [l["cumulative"] for l in above_sorted]
chk("Kumulative steigt vom Preis aufwaerts monoton",
    all(cums_a[i] <= cums_a[i + 1] + 1e-6 for i in range(len(cums_a) - 1)))

print("── Cluster ──")
chk("clustersBelow max 3", len(d["clustersBelow"]) <= 3)
chk("clustersAbove max 3", len(d["clustersAbove"]) <= 3)
chk("clustersBelow negative Distanz",
    all(c["distPct"] < 0 for c in d["clustersBelow"]))
chk("clustersAbove positive Distanz",
    all(c["distPct"] >= 0 for c in d["clustersAbove"]))
chk("Cluster absteigend nach USD sortiert",
    all(d["clustersAbove"][i]["usd"] >= d["clustersAbove"][i + 1]["usd"]
        for i in range(len(d["clustersAbove"]) - 1)))

print("── Zeit-Decay ──")
# Wichtig: oi_usd=0 -> keine Normierung, damit die absoluten Beitraege
# vergleichbar bleiben. Mit Normierung wuerde genau der Unterschied,
# den dieser Test misst, wieder herausskaliert.
ks = mk_klines(n=100, vol=1.0)
ks[-1].volume = 50.0; ks[-1].taker_buy = 25.0     # jung + gross
d_new = _build_map(ks, 100.0, 0.0, 60)
ks2 = mk_klines(n=100, vol=1.0)
ks2[0].volume = 50.0; ks2[0].taker_buy = 25.0     # alt + gross
d_old = _build_map(ks2, 100.0, 0.0, 60)
chk("junge Grosskerze wiegt schwerer als alte",
    d_new["totalUsd"] > d_old["totalUsd"] * 1.5,
    f"neu={d_new['totalUsd']:.0f} alt={d_old['totalUsd']:.0f}")

d_flat = _build_map(mk_klines(n=100, vol=1.0), 100.0, 0.0, 60)
chk("Decay reduziert Gesamtgewicht gegenueber ungedaempft",
    d_flat["totalUsd"] < 100 * 1.0 * 100.0,
    f"{d_flat['totalUsd']:.0f}")

print("── Randfaelle ──")
chk("leere Klines -> leere Level", _build_map([], 100.0, 1e6, 60)["levels"] == [])
chk("Preis 0 -> leere Level", _build_map(mk_klines(), 0.0, 1e6, 60)["levels"] == [])
chk("Null-Volumen -> leere Level",
    _build_map(mk_klines(vol=0.0), 100.0, 1e6, 60)["levels"] == [])
chk("Range um Preis begrenzt (±20%)",
    d["low"] >= 100.0 * 0.80 - 1e-6 and d["high"] <= 100.0 * 1.20 + 1e-6,
    f"{d['low']:.2f}-{d['high']:.2f}")
chk("alle Fenster definiert", set(WINDOWS) == {"12h", "1d", "3d", "1w", "1m"})

print("\n" + ("ALLE TESTS BESTANDEN" if ok else "TESTS FEHLGESCHLAGEN"))
sys.exit(0 if ok else 1)
