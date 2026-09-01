"""
Liquidation Map — CoinGlass-Style, komplett aus kostenlosen Boersen-Rohdaten.

Idee
----
CoinGlass zeigt in der "Liquidation Map" fuer jedes Preis-Level, wieviel
gehebeltes Notional dort liquidiert wuerde. Die Original-Daten sind
kostenpflichtig, das Modell dahinter laesst sich aber aus oeffentlichen
Futures-Daten rekonstruieren:

1. Klines der Lookback-Periode liefern, wo Volumen gehandelt wurde
   (= wo Positionen eroeffnet wurden) und zu welchem Preis.
2. Das Taker-Buy/Sell-Verhaeltnis jeder Kerze splittet dieses Volumen in
   Long- und Short-Eroeffnungen.
3. Jede Eroeffnung wird auf die Leverage-Tiers (10x/25x/50x/100x) verteilt.
   Fuer Entry P und Hebel L gilt naeherungsweise
       Long-Liq  = P * (1 - 1/L + MMR)
       Short-Liq = P * (1 + 1/L - MMR)
4. Aeltere Kerzen werden exponentiell abgewertet (Positionen werden
   geschlossen), das Ergebnis wird auf das tatsaechliche Open Interest
   in USD normiert.
5. Nur noch nicht ausgeloeste Level zaehlen: Long-Liqs unterhalb des
   Preises, Short-Liqs oberhalb.

Das Ergebnis ist eine Naeherung, keine Boersen-Innenansicht — aber es
nutzt dieselben oeffentlichen Signale (Volumen, Taker-Delta, OI), aus
denen auch kommerzielle Anbieter ihre Karten rechnen.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import httpx

from tradepro.core.config import BN_FUT_REST, BY_REST, BYBIT_TF

# Leverage-Tiers wie in der CoinGlass Liquidation Map, mit geschaetztem
# Anteil am gehebelten Volumen (kleine Hebel sind haeufiger, tragen aber
# pro Position mehr Notional -> Gewichte sind empirisch gewaehlt).
LEVERAGE_TIERS: list[tuple[int, float, str]] = [
    (10, 0.34, "#4bc0f0"),
    (25, 0.28, "#2ee6a8"),
    (50, 0.23, "#f7c948"),
    (100, 0.15, "#ff7a45"),
]

# Maintenance-Margin-Rate (Binance BTCUSDT Tier 1 = 0.4%)
MMR = 0.004

# Lookback-Fenster -> (Kline-Intervall, Anzahl Kerzen)
WINDOWS: dict[str, tuple[str, int]] = {
    "12h": ("5m", 144),
    "1d": ("15m", 96),
    "3d": ("30m", 144),
    "1w": ("1h", 168),
    "1m": ("4h", 180),
}

# Halbwertszeit einer offenen Position, als Anteil des Lookback-Fensters.
# 0.5 => Positionen vom Anfang des Fensters zaehlen noch mit ~25%.
DECAY_HALFLIFE_FRAC = 0.5


@dataclass
class _Kline:
    time: int          # Sekunden
    close: float
    high: float
    low: float
    volume: float      # Basis-Volumen
    taker_buy: float   # Basis-Volumen der Taker-Buys


async def _get(client: httpx.AsyncClient, url: str, params: dict | None = None):
    r = await client.get(url, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


async def _load_klines(client, symbol: str, exchange: str,
                       interval: str, limit: int) -> list[_Kline]:
    if exchange == "bybit":
        d = await _get(client, f"{BY_REST}/market/kline", {
            "category": "linear", "symbol": symbol,
            "interval": BYBIT_TF.get(interval, "60"), "limit": min(limit, 1000),
        })
        rows = list(reversed(d["result"]["list"]))
        # Bybit-Klines haben kein Taker-Buy-Feld -> 50/50 als Fallback.
        return [_Kline(
            time=int(int(r[0]) // 1000), close=float(r[4]),
            high=float(r[2]), low=float(r[3]),
            volume=float(r[5]), taker_buy=float(r[5]) * 0.5,
        ) for r in rows]

    d = await _get(client, f"{BN_FUT_REST}/klines", {
        "symbol": symbol, "interval": interval, "limit": min(limit, 1500),
    })
    return [_Kline(
        time=int(k[0] // 1000), close=float(k[4]),
        high=float(k[2]), low=float(k[3]),
        volume=float(k[5]), taker_buy=float(k[9]),
    ) for k in d]


async def _load_price_and_oi(client, symbol: str, exchange: str) -> tuple[float, float]:
    """Gibt (letzter Preis, Open Interest in USD) zurueck."""
    if exchange == "bybit":
        d = await _get(client, f"{BY_REST}/market/tickers",
                       {"category": "linear", "symbol": symbol})
        t = d["result"]["list"][0]
        price = float(t["lastPrice"])
        return price, float(t.get("openInterest", 0) or 0) * price

    t = await _get(client, f"{BN_FUT_REST}/ticker/price", {"symbol": symbol})
    price = float(t["price"])
    oi_usd = 0.0
    try:
        oi = await _get(client, f"{BN_FUT_REST}/openInterest", {"symbol": symbol})
        oi_usd = float(oi["openInterest"]) * price
    except Exception:
        pass
    return price, oi_usd


def _build_map(klines: list[_Kline], price: float, oi_usd: float,
               bins: int) -> dict:
    """Kernberechnung — rein synchron und damit direkt testbar."""
    if not klines or price <= 0:
        return {"levels": [], "tiers": [], "price": price, "bins": []}

    newest = klines[-1].time
    oldest = klines[0].time
    span = max(newest - oldest, 1)
    halflife = span * DECAY_HALFLIFE_FRAC

    # Rohe Liquidationspunkte: (liq_price, notional_gewicht, side, leverage)
    raw: list[tuple[float, float, str, int]] = []

    for k in klines:
        if k.volume <= 0:
            continue
        entry = (k.high + k.low + k.close) / 3.0     # typischer Preis
        if entry <= 0:
            continue
        notional = k.volume * entry
        # Zeit-Decay: aeltere Positionen sind wahrscheinlicher schon zu.
        age = newest - k.time
        weight = 0.5 ** (age / halflife) if halflife > 0 else 1.0
        notional *= weight

        buy_ratio = k.taker_buy / k.volume if k.volume > 0 else 0.5
        buy_ratio = min(max(buy_ratio, 0.05), 0.95)
        long_notional = notional * buy_ratio
        short_notional = notional * (1.0 - buy_ratio)

        for lev, share, _color in LEVERAGE_TIERS:
            long_liq = entry * (1.0 - 1.0 / lev + MMR)
            short_liq = entry * (1.0 + 1.0 / lev - MMR)
            # Nur Level, die noch nicht durchlaufen wurden.
            if long_liq < price:
                raw.append((long_liq, long_notional * share, "long", lev))
            if short_liq > price:
                raw.append((short_liq, short_notional * share, "short", lev))

    if not raw:
        return {"levels": [], "tiers": [], "price": price, "bins": []}

    lo = min(p for p, *_ in raw)
    hi = max(p for p, *_ in raw)
    # Karte auf ein sinnvolles Fenster um den Preis begrenzen (wie CoinGlass).
    lo = max(lo, price * 0.80)
    hi = min(hi, price * 1.20)
    if hi <= lo:
        lo, hi = price * 0.9, price * 1.1
    bin_size = (hi - lo) / bins

    # buckets[i] = {leverage: notional}
    buckets: list[dict[int, float]] = [dict() for _ in range(bins)]
    side_of_bin: list[dict[str, float]] = [
        {"long": 0.0, "short": 0.0} for _ in range(bins)
    ]

    for liq_price, notional, side, lev in raw:
        if liq_price < lo or liq_price > hi:
            continue
        i = min(int((liq_price - lo) / bin_size), bins - 1)
        buckets[i][lev] = buckets[i].get(lev, 0.0) + notional
        side_of_bin[i][side] += notional

    total = sum(sum(b.values()) for b in buckets)
    if total <= 0:
        return {"levels": [], "tiers": [], "price": price, "bins": []}

    # Auf tatsaechliches Open Interest normieren, damit die USD-Achse
    # eine reale Groessenordnung hat.
    scale = (oi_usd / total) if oi_usd > 0 else 1.0

    levels = []
    for i, b in enumerate(buckets):
        tot = sum(b.values()) * scale
        if tot <= 0:
            continue
        sides = side_of_bin[i]
        levels.append({
            "price": lo + (i + 0.5) * bin_size,
            "total": tot,
            "byLeverage": {str(lev): v * scale for lev, v in sorted(b.items())},
            "side": "long" if sides["long"] >= sides["short"] else "short",
            "longUsd": sides["long"] * scale,
            "shortUsd": sides["short"] * scale,
        })

    # Kumulative Kurven (wie die roten/gruenen Linien bei CoinGlass):
    # nach unten kumuliert fuer Longs, nach oben fuer Shorts.
    below = [l for l in levels if l["price"] < price]
    above = [l for l in levels if l["price"] >= price]
    acc = 0.0
    for l in reversed(below):          # vom Preis abwaerts
        acc += l["total"]
        l["cumulative"] = acc
    acc = 0.0
    for l in above:                    # vom Preis aufwaerts
        acc += l["total"]
        l["cumulative"] = acc

    max_total = max(l["total"] for l in levels)
    tiers = [{"leverage": lev, "color": color,
              "usd": sum(b.get(lev, 0.0) for b in buckets) * scale}
             for lev, _share, color in LEVERAGE_TIERS]

    # Top-Cluster: die staerksten Magnete ueber und unter dem Preis.
    def _top(pool, n=3):
        return [{
            "price": l["price"], "usd": l["total"], "side": l["side"],
            "distPct": (l["price"] - price) / price * 100.0,
        } for l in sorted(pool, key=lambda x: -x["total"])[:n]]

    return {
        "symbol": None,
        "price": price,
        "oiUsd": oi_usd,
        "low": lo,
        "high": hi,
        "binSize": bin_size,
        "maxTotal": max_total,
        "totalUsd": sum(l["total"] for l in levels),
        "levels": levels,
        "tiers": tiers,
        "clustersBelow": _top(below),
        "clustersAbove": _top(above),
    }


async def liquidation_map(symbol: str = "BTCUSDT", exchange: str = "binance",
                          window: str = "1d", bins: int = 90) -> dict:
    """Baut die Liquidation Map fuer ein Symbol."""
    symbol = symbol.upper()
    window = window if window in WINDOWS else "1d"
    bins = max(30, min(int(bins), 200))
    interval, limit = WINDOWS[window]

    async with httpx.AsyncClient() as c:
        klines = await _load_klines(c, symbol, exchange, interval, limit)
        price, oi_usd = await _load_price_and_oi(c, symbol, exchange)

    out = _build_map(klines, price, oi_usd, bins)
    out["symbol"] = symbol
    out["exchange"] = exchange
    out["window"] = window
    out["candles"] = len(klines)
    return out


def leverage_palette() -> list[dict]:
    return [{"leverage": lev, "color": color} for lev, _s, color in LEVERAGE_TIERS]
