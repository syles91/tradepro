#!/usr/bin/env python3
"""
TradePro — KI-Assistent
=======================
Sammelt einen kompakten Markt-Snapshot (Indikatoren, Futures-Daten, CVD,
Volume Profile, Liquidationen, Orderbook) und laesst ihn von Claude beurteilen.

Wird sowohl vom Live-Terminal (/api/ai/analyze) als auch spaeter vom
autonomen Cron-Beobachter genutzt — gather_snapshot() ist die gemeinsame Basis.
"""

import json
import os
from pathlib import Path

import httpx

# ── Binance / Bybit Endpoints (gespiegelt von server_v2) ─────────────────────
BN_FUT_REST = "https://fapi.binance.com/fapi/v1"
BN_FUT_DATA = "https://fapi.binance.com/futures/data"
BY_REST     = "https://api.bybit.com/v5"
BYBIT_TF = {"1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}

ANTHROPIC_MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1100


# ── Hermes .env Key-Loader ────────────────────────────────────────────────────
def load_anthropic_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    env_path = Path("/home/hermes/.hermes/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("ANTHROPIC_API_KEY=") and "=" in line:
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


# ── Indikatoren (leichtgewichtig) ─────────────────────────────────────────────
def ema(values, period):
    if not values:
        return []
    k = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
    if al == 0:
        return 100.0
    return 100 - (100 / (1 + ag / al))


def macd_sign(closes):
    if len(closes) < 35:
        return "n/a"
    ef = ema(closes, 12)
    es = ema(closes, 26)
    macd_line = [f - s for f, s in zip(ef, es)]
    sig = ema(macd_line, 9)
    return "bullisch" if macd_line[-1] > sig[-1] else "bärisch"


async def _get(client, url, params=None):
    r = await client.get(url, params=params, timeout=10)
    r.raise_for_status()
    return r.json()


# ── Snapshot-Sammler ──────────────────────────────────────────────────────────
async def gather_snapshot(symbol="BTCUSDT", tf="5m", exchange="binance"):
    """Sammelt alle relevanten Marktdaten als kompaktes Dict."""
    symbol = symbol.upper()
    snap = {"symbol": symbol, "tf": tf, "exchange": exchange}

    async with httpx.AsyncClient() as c:
        # 1. Klines + Indikatoren
        try:
            if exchange == "bybit":
                d = await _get(c, f"{BY_REST}/market/kline",
                               {"category": "linear", "symbol": symbol,
                                "interval": BYBIT_TF.get(tf, "5"), "limit": 250})
                rows = list(reversed(d["result"]["list"]))
                closes = [float(r[4]) for r in rows]
                highs  = [float(r[2]) for r in rows]
                lows   = [float(r[3]) for r in rows]
                vols   = [float(r[5]) for r in rows]
            else:
                d = await _get(c, f"{BN_FUT_REST}/klines",
                               {"symbol": symbol, "interval": tf, "limit": 250})
                closes = [float(k[4]) for k in d]
                highs  = [float(k[2]) for k in d]
                lows   = [float(k[3]) for k in d]
                vols   = [float(k[5]) for k in d]
            price = closes[-1]
            snap["price"] = price
            snap["rsi"] = round(rsi(closes), 1)
            snap["macd"] = macd_sign(closes)
            e20, e50, e200 = ema(closes, 20)[-1], ema(closes, 50)[-1], ema(closes, 200)[-1]
            snap["ema20"] = round(e20, 2)
            snap["ema50"] = round(e50, 2)
            snap["ema200"] = round(e200, 2)
            snap["trend_ema200"] = ("über" if price > e200 else "unter") + \
                f" EMA200 ({(price-e200)/e200*100:+.1f}%)"
            snap["ema_cross"] = "EMA20>EMA50 (bullisch)" if e20 > e50 else "EMA20<EMA50 (bärisch)"
            # Momentum über letzte 24 Kerzen
            if len(closes) > 25:
                snap["change_recent"] = round((price - closes[-25]) / closes[-25] * 100, 2)
            avg_vol = sum(vols[-20:]) / 20 if len(vols) >= 20 else 0
            snap["vol_spike"] = bool(avg_vol and vols[-1] > avg_vol * 1.5)
        except Exception as e:
            snap["klines_error"] = str(e)[:80]

        # 2. Ticker (24h)
        try:
            if exchange == "bybit":
                d = await _get(c, f"{BY_REST}/market/tickers",
                               {"category": "linear", "symbol": symbol})
                t = d["result"]["list"][0]
                snap["change_24h"] = round(float(t.get("price24hPcnt", 0)) * 100, 2)
                snap["vol_24h_usd"] = round(float(t["turnover24h"]) / 1e9, 2)
                snap["oi_now"] = round(float(t.get("openInterest", 0)) * float(t["lastPrice"]) / 1e9, 2)
            else:
                t = await _get(c, f"{BN_FUT_REST}/ticker/24hr", {"symbol": symbol})
                oi = await _get(c, f"{BN_FUT_REST}/openInterest", {"symbol": symbol})
                snap["change_24h"] = round(float(t["priceChangePercent"]), 2)
                snap["vol_24h_usd"] = round(float(t["quoteVolume"]) / 1e9, 2)
                snap["oi_now"] = round(float(oi["openInterest"]) * float(t["lastPrice"]) / 1e9, 2)
        except Exception:
            pass

        # 3. Funding (aktuell)
        try:
            prem = await _get(c, f"{BN_FUT_REST}/premiumIndex", {"symbol": symbol})
            snap["funding"] = round(float(prem.get("lastFundingRate", 0)) * 100, 4)
        except Exception:
            pass

        # 4. OI-Trend (24h)
        try:
            oih = await _get(c, f"{BN_FUT_DATA}/openInterestHist",
                             {"symbol": symbol, "period": "1h", "limit": 24})
            if len(oih) >= 2:
                first = float(oih[0]["sumOpenInterestValue"])
                last = float(oih[-1]["sumOpenInterestValue"])
                snap["oi_change_24h"] = round((last - first) / first * 100, 1) if first else 0
        except Exception:
            pass

        # 5. Long/Short Ratio (Binance, global + top)
        try:
            g = await _get(c, f"{BN_FUT_DATA}/globalLongShortAccountRatio",
                           {"symbol": symbol, "period": "1h", "limit": 1})
            tp = await _get(c, f"{BN_FUT_DATA}/topLongShortPositionRatio",
                            {"symbol": symbol, "period": "1h", "limit": 1})
            if g:
                snap["ls_global_long"] = round(float(g[-1]["longAccount"]) * 100, 1)
            if tp:
                snap["ls_top_long"] = round(float(tp[-1]["longAccount"]) * 100, 1)
        except Exception:
            pass

        # 6. CVD-Trend (letzte 50 Kerzen, Binance)
        try:
            kl = await _get(c, f"{BN_FUT_REST}/klines",
                            {"symbol": symbol, "interval": tf, "limit": 50})
            cvd = 0.0
            cvd_start = None
            for i, k in enumerate(kl):
                vol = float(k[5]); tb = float(k[9])
                cvd += 2 * tb - vol
                if i == 0:
                    cvd_start = cvd
            snap["cvd_trend"] = "steigend (Käufer)" if cvd > cvd_start else "fallend (Verkäufer)"
        except Exception:
            pass

        # 7. Volume Profile (POC/VAH/VAL)
        try:
            from server_v2 import api_volume_profile  # gleiche Logik wiederverwenden
            vp = json.loads((await api_volume_profile(symbol, tf, 250, exchange, 60)).body)
            if vp.get("poc"):
                snap["poc"] = round(vp["poc"], 2)
                snap["vah"] = round(vp["vah"], 2)
                snap["val"] = round(vp["val"], 2)
                p = snap.get("price")
                if p:
                    if p > vp["vah"]:
                        snap["vp_position"] = "Preis ÜBER Value Area (überdehnt nach oben)"
                    elif p < vp["val"]:
                        snap["vp_position"] = "Preis UNTER Value Area (überdehnt nach unten)"
                    else:
                        snap["vp_position"] = "Preis IN Value Area (fair gehandelt)"
        except Exception:
            pass

        # 8. Orderbook-Imbalance
        try:
            if exchange == "bybit":
                d = await _get(c, f"{BY_REST}/market/orderbook",
                               {"category": "linear", "symbol": symbol, "limit": 50})
                bids = [[float(p), float(q)] for p, q in d["result"].get("b", [])]
                asks = [[float(p), float(q)] for p, q in d["result"].get("a", [])]
            else:
                d = await _get(c, f"{BN_FUT_REST}/depth", {"symbol": symbol, "limit": 50})
                bids = [[float(p), float(q)] for p, q in d.get("bids", [])]
                asks = [[float(p), float(q)] for p, q in d.get("asks", [])]
            bs = sum(q for _, q in bids); as_ = sum(q for _, q in asks)
            if bs + as_:
                imb = (bs - as_) / (bs + as_)
                snap["ob_imbalance"] = round(imb * 100, 1)
                snap["ob_bias"] = "Kaufdruck" if imb > 0.1 else "Verkaufsdruck" if imb < -0.1 else "ausgeglichen"
        except Exception:
            pass

    return snap


# ── Liquidationen aus dem laufenden Hub (optional) ────────────────────────────
def liquidation_summary(hub, exchange, symbol):
    liqs = list(hub.liqs.get(f"{exchange}:{symbol.upper()}", []))
    if not liqs:
        return None
    long_usd = sum(l["usd"] for l in liqs if l["side"] == "SELL")
    short_usd = sum(l["usd"] for l in liqs if l["side"] == "BUY")
    return {"count": len(liqs), "long_liq_usd": round(long_usd),
            "short_liq_usd": round(short_usd)}


# ── Prompt-Bau ────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Du bist ein erfahrener Krypto-Trading-Analyst im TradePro-Terminal.
Du beurteilst Märkte nüchtern und präzise auf Deutsch. Du gibst KEINE Finanzberatung,
sondern eine technische Einschätzung der Marktlage.

Struktur deiner Antwort (kurz und konkret, Markdown):
1. **Gesamtbild** — 1 Satz: bullisch / bärisch / neutral + Konfidenz
2. **Wichtigste Signale** — 3-5 Stichpunkte aus den Daten (was stützt die Einschätzung)
3. **Risiken / Gegenargumente** — 1-2 Punkte
4. **Schlüssel-Levels** — relevante Preise (POC, VAH/VAL, EMA200)

Sei konkret mit Zahlen. Keine Floskeln. Erkläre Fachbegriffe NICHT (der Nutzer kennt sie).
Schließe mit einem dezenten Hinweis: '_Keine Finanzberatung._'"""


def build_user_prompt(snap, liq_sum=None, question=None):
    lines = [f"Markt-Snapshot {snap['symbol']} ({snap['exchange']}, Timeframe {snap['tf']}):", ""]
    label = {
        "price": "Preis", "change_24h": "24h-Änderung %", "change_recent": "Änderung letzte 24 Kerzen %",
        "rsi": "RSI", "macd": "MACD", "trend_ema200": "Trend",
        "ema_cross": "EMA-Kreuzung", "ema200": "EMA200",
        "vol_24h_usd": "24h-Volumen (Mrd $)", "vol_spike": "Volumen-Spike",
        "oi_now": "Open Interest (Mrd $)", "oi_change_24h": "OI-Änderung 24h %",
        "funding": "Funding Rate %", "ls_global_long": "Long/Short Global (% Long)",
        "ls_top_long": "Top Trader (% Long)", "cvd_trend": "CVD-Trend",
        "poc": "POC", "vah": "VAH", "val": "VAL", "vp_position": "Volume-Profile-Lage",
        "ob_imbalance": "Orderbook-Imbalance %", "ob_bias": "Orderbook-Tendenz",
    }
    for k, lbl in label.items():
        if k in snap:
            lines.append(f"- {lbl}: {snap[k]}")
    if liq_sum:
        lines.append(f"- Liquidationen (aktuell): {liq_sum['count']} Events, "
                     f"Long liquidiert ${liq_sum['long_liq_usd']:,}, "
                     f"Short liquidiert ${liq_sum['short_liq_usd']:,}")
    lines.append("")
    if question:
        lines.append(f"Konkrete Frage des Nutzers: {question}")
    else:
        lines.append("Beurteile die aktuelle Marktlage.")
    return "\n".join(lines)


# ── Claude-Streaming ──────────────────────────────────────────────────────────
async def stream_analysis(snap, liq_sum=None, question=None):
    """Async-Generator: yieldet Text-Chunks von Claude."""
    import anthropic
    key = load_anthropic_key()
    if not key:
        yield "⚠️ Kein Anthropic-API-Key gefunden."
        return
    client = anthropic.AsyncAnthropic(api_key=key)
    user_prompt = build_user_prompt(snap, liq_sum, question)
    try:
        async with client.messages.stream(
            model=ANTHROPIC_MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield text
    except Exception as e:
        yield f"\n\n⚠️ Fehler bei der Analyse: {str(e)[:150]}"
