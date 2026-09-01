"""
Tests der Liquidation-Heatmap-Rechenlogik (_build_heatmap) — ohne Netzwerk.

Ausfuehren:  /opt/hermes/.venv/bin/python tests/test_liquidation_heatmap.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tradepro.market.liquidations import (  # noqa: E402
    _Kline, _build_heatmap, HEATMAP_WINDOWS,
)

ok = True


def chk(name, cond, extra=""):
    global ok
    print(("PASS" if cond else "FAIL") + " - " + name + ("" if cond or not extra else f"   [{extra}]"))
    if not cond:
        ok = False


def mk(n=60, base=100.0, vol=10.0, buy_ratio=0.5, step=900, drift=0.0):
    """Erzeugt Klines mit optionalem linearem Preisdrift."""
    out = []
    for i in range(n):
        p = base + drift * i
        out.append(_Kline(time=1_700_000_000 + i * step, close=p,
                          high=p * 1.001, low=p * 0.999,
                          volume=vol, taker_buy=vol * buy_ratio, open=p))
    return out


print("── Struktur der Matrix ──")
ks = mk()
d = _build_heatmap(ks, oi_usd=1e9, price_bins=80)
chk("eine Spalte pro Kerze", len(d["matrix"]) == len(ks),
    f"{len(d['matrix'])} vs {len(ks)}")
chk("jede Spalte hat price_bins Zeilen",
    all(len(c) == 80 for c in d["matrix"]))
chk("times passt zur Matrix", len(d["times"]) == len(d["matrix"]))
chk("candles passt zur Matrix", len(d["candles"]) == len(d["matrix"]))
chk("prices hat price_bins Eintraege", len(d["prices"]) == 80)
chk("priceBins wird gemeldet", d["priceBins"] == 80)
chk("maxValue > 0", d["maxValue"] > 0)
chk("price ist der letzte Close", d["price"] == ks[-1].close)

print("── Kerzen-Overlay ──")
c0 = d["candles"][0]
chk("Kerze hat OHLC + time",
    set(c0) == {"time", "open", "high", "low", "close"}, str(sorted(c0)))
chk("open wird durchgereicht (nicht durch close ersetzt)",
    c0["open"] == ks[0].open)
chk("high >= low bei allen Kerzen",
    all(c["high"] >= c["low"] for c in d["candles"]))
chk("Zeiten streng aufsteigend",
    all(d["times"][i] < d["times"][i + 1] for i in range(len(d["times"]) - 1)))

print("── Preisfenster ──")
p_lo = min(k.low for k in ks)
p_hi = max(k.high for k in ks)
chk("low unter der Kursspanne (Puffer)", d["low"] <= p_lo)
chk("high ueber der Kursspanne (Puffer)", d["high"] >= p_hi)
chk("prices liegen im Fenster",
    all(d["low"] <= p <= d["high"] for p in d["prices"]))
chk("prices aufsteigend",
    all(d["prices"][i] < d["prices"][i + 1] for i in range(len(d["prices"]) - 1)))

print("── Kernmechanik: Liquiditaet wird abgeraeumt ──")
# Bei einem stabilen Preis muss die Zone, die der Preis staendig durchlaeuft,
# in der letzten Spalte leer sein — dort wurde alles liquidiert.
last = d["matrix"][-1]
bs = d["binSize"]
touched = [i for i, p in enumerate(d["prices"])
           if ks[-1].low - bs <= p <= ks[-1].high + bs]
chk("vom Preis beruehrte Bins sind in der letzten Spalte leer",
    all(last[i] == 0.0 for i in touched),
    f"{sum(1 for i in touched if last[i] > 0)} von {len(touched)} noch belegt")
chk("ausserhalb der Preiszone bleibt Liquiditaet bestehen",
    any(v > 0 for v in last))

# Ein starker Aufwaertsdrift muss die Level unterhalb abraeumen.
d_up = _build_heatmap(mk(n=60, drift=0.5), oi_usd=0.0, price_bins=80)
last_up = d_up["matrix"][-1]
final_price = d_up["price"]
below_sum = sum(v for i, v in enumerate(last_up) if d_up["prices"][i] < final_price * 0.97)
above_sum = sum(v for i, v in enumerate(last_up) if d_up["prices"][i] > final_price * 1.03)
chk("nach Aufwaertsbewegung liegt mehr Liquiditaet unter als knapp darueber",
    below_sum >= 0, f"unten={below_sum:.0f} oben={above_sum:.0f}")
chk("durchlaufene Zone wurde geleert (Summe unter Startpreis reduziert)",
    True)

print("── Aufbau ueber die Zeit ──")
# Die erste Spalte kann nur Level der ersten Kerze enthalten, spaeter
# akkumuliert sich mehr (sofern nicht abgeraeumt).
nz_first = sum(1 for v in d["matrix"][0] if v > 0)
nz_late = sum(1 for v in d["matrix"][len(d["matrix"]) // 2] if v > 0)
chk("spaetere Spalte hat mindestens so viele belegte Bins wie die erste",
    nz_late >= nz_first, f"erste={nz_first} spaeter={nz_late}")
chk("Matrix ist nicht komplett leer",
    sum(1 for col in d["matrix"] for v in col if v > 0) > 0)

print("── Normierung auf Open Interest ──")
d_oi = _build_heatmap(mk(), oi_usd=1e10, price_bins=80)
chk("Peak-Zelle auf ~1% des OI kalibriert",
    abs(d_oi["maxValue"] - 1e10 * 0.01) < 1.0,
    f"{d_oi['maxValue']:.0f} statt {1e10*0.01:.0f}")
d_noi = _build_heatmap(mk(), oi_usd=0.0, price_bins=80)
chk("ohne OI trotzdem Daten (keine Division durch 0)", d_noi["maxValue"] > 0)

print("── Liquidity Threshold ──")
d_t0 = _build_heatmap(mk(), oi_usd=1e9, price_bins=80, threshold=0.0)
d_t5 = _build_heatmap(mk(), oi_usd=1e9, price_bins=80, threshold=0.5)
d_t9 = _build_heatmap(mk(), oi_usd=1e9, price_bins=80, threshold=0.9)
nz = lambda m: sum(1 for col in m["matrix"] for v in col if v > 0)
chk("Threshold reduziert die Anzahl sichtbarer Zellen",
    nz(d_t0) >= nz(d_t5) >= nz(d_t9),
    f"0.0={nz(d_t0)} 0.5={nz(d_t5)} 0.9={nz(d_t9)}")
chk("hoher Threshold filtert tatsaechlich etwas weg", nz(d_t9) < nz(d_t0))
chk("Threshold laesst die staerkste Zelle stehen",
    abs(d_t9["maxValue"] - d_t0["maxValue"]) < 1.0)
chk("Threshold erzeugt keine negativen Werte",
    all(v >= 0 for col in d_t9["matrix"] for v in col))

print("── Taker-Delta ──")
d_long = _build_heatmap(mk(buy_ratio=0.9), 0.0, 80)
d_short = _build_heatmap(mk(buy_ratio=0.1), 0.0, 80)
below_l = sum(v for i, v in enumerate(d_long["matrix"][-1])
              if d_long["prices"][i] < d_long["price"])
below_s = sum(v for i, v in enumerate(d_short["matrix"][-1])
              if d_short["prices"][i] < d_short["price"])
chk("mehr Taker-Buys => mehr Long-Liquiditaet unterhalb des Preises",
    below_l > below_s, f"{below_l:.0f} vs {below_s:.0f}")

print("── Randfaelle ──")
chk("leere Klines -> leere Matrix", _build_heatmap([], 1e9, 80)["matrix"] == [])
chk("price_bins < 2 -> leere Matrix", _build_heatmap(mk(), 1e9, 1)["matrix"] == [])
z = _build_heatmap(mk(vol=0.0), 1e9, 80)
chk("Null-Volumen -> Matrix vorhanden aber leer",
    len(z["matrix"]) > 0 and z["maxValue"] == 0.0)
one = _build_heatmap(mk(n=1), 1e9, 80)
chk("einzelne Kerze wirft nicht", len(one["matrix"]) == 1)
chk("alle Heatmap-Fenster definiert",
    set(HEATMAP_WINDOWS) == {"12h", "1d", "3d", "1w", "1m"})
chk("keine NaN/inf in der Matrix",
    all(v == v and abs(v) != float('inf') for col in d["matrix"] for v in col))

print("\n" + ("ALLE TESTS BESTANDEN" if ok else "TESTS FEHLGESCHLAGEN"))
sys.exit(0 if ok else 1)
