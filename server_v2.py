#!/usr/bin/env python3
"""
TradePro Backend v3 — Multi-Exchange Crypto Terminal
=====================================================
Exchanges: Binance (Spot-WS + Futures-REST), Bybit (Linear-WS all-in-one)

  Binance:  stream.binance.com:9443 (WS, Candles) + fapi.binance.com (REST)
            fstream.binance.com (Futures-WS) GEBLOCKT -> Liquidationen leer
  Bybit:    stream.bybit.com/v5/public/linear (WS: kline+tickers+liquidation)
            api.bybit.com (REST)  -> liefert ALLES inkl. Live-Liquidationen

Frontend waehlt Exchange. Pro (exchange, symbol, tf) genau EIN Upstream.
"""

import asyncio
import json
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Dict, Set

import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import ai_assistant as ai

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

# ── Binance ──────────────────────────────────────────────────────────────────
BN_FUT_REST = "https://fapi.binance.com/fapi/v1"
BN_FUT_DATA = "https://fapi.binance.com/futures/data"
BN_SPOT_WS  = "wss://stream.binance.com:9443/stream"
BN_FUT_WS   = "wss://fstream.binance.com/stream"   # geblockt in diesem Container

# ── Bybit ────────────────────────────────────────────────────────────────────
BY_REST = "https://api.bybit.com/v5"
BY_WS   = "wss://stream.bybit.com/v5/public/linear"

# Timeframe-Mapping (UI -> exchange-spezifisch)
TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"]
BYBIT_TF = {"1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}

EXCHANGES = ["binance", "bybit"]
DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
                   "DOGEUSDT", "AVAXUSDT", "LINKUSDT"]

app = FastAPI(title="TradePro")


async def fetch_json(client, url, params=None):
    r = await client.get(url, params=params, timeout=10)
    r.raise_for_status()
    return r.json()


# ══════════════════════════════════════════════════════════════════════════════
#  HUB — Multi-Exchange WebSocket-Verteiler
# ══════════════════════════════════════════════════════════════════════════════
class Hub:
    def __init__(self):
        self.subs: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.tasks: Dict[str, asyncio.Task] = {}
        self.last_mark: Dict[str, dict] = {}                       # key: ex:SYMBOL
        self.liqs: Dict[str, deque] = defaultdict(lambda: deque(maxlen=50))

    def key(self, ex: str, symbol: str, tf: str) -> str:
        return f"{ex}:{symbol.upper()}@{tf}"

    def meta_key(self, ex: str, symbol: str) -> str:
        return f"META:{ex}:{symbol.upper()}"

    def liq_id(self, ex: str, symbol: str) -> str:
        return f"{ex}:{symbol.upper()}"

    async def subscribe(self, ws: WebSocket, ex: str, symbol: str, tf: str):
        symbol = symbol.upper()
        k = self.key(ex, symbol, tf)
        self.subs[k].add(ws)
        if k not in self.tasks or self.tasks[k].done():
            if ex == "bybit":
                self.tasks[k] = asyncio.create_task(self.relay_bybit(symbol, tf, k))
            else:
                self.tasks[k] = asyncio.create_task(self.relay_binance(symbol, tf, k))
        # Binance braucht separaten REST-Poller fuer Mark/Funding.
        # Bybit liefert das im selben WS-Stream (tickers) -> kein Poller noetig.
        if ex == "binance":
            mk = self.meta_key(ex, symbol)
            if mk not in self.tasks or self.tasks[mk].done():
                self.tasks[mk] = asyncio.create_task(self.binance_futures_poller(symbol, mk))

    def unsubscribe(self, ws: WebSocket):
        for k, clients in list(self.subs.items()):
            clients.discard(ws)
            if not clients and k in self.tasks:
                self.tasks[k].cancel()
                self.tasks.pop(k, None)
                self.subs.pop(k, None)

    def _symbol_active(self, ex: str, symbol: str) -> bool:
        prefix = f"{ex}:{symbol.upper()}@"
        return any(clients and k.startswith(prefix) for k, clients in self.subs.items())

    async def push(self, k: str, msg: dict):
        dead = set()
        for ws in self.subs.get(k, set()):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.subs[k].discard(ws)

    async def push_symbol(self, ex: str, symbol: str, msg: dict):
        """An alle Clients dieses (exchange, symbol), egal welcher TF."""
        prefix = f"{ex}:{symbol.upper()}@"
        for k, clients in list(self.subs.items()):
            if k.startswith(prefix):
                dead = set()
                for ws in clients:
                    try:
                        await ws.send_json(msg)
                    except Exception:
                        dead.add(ws)
                for ws in dead:
                    clients.discard(ws)

    # ── Binance Relay (Spot-WS: Candles + Trades) ─────────────────────────────
    async def relay_binance(self, symbol: str, tf: str, k: str):
        sym_l = symbol.lower()
        streams = f"{sym_l}@kline_{tf}/{sym_l}@aggTrade"
        url = f"{BN_SPOT_WS}?streams={streams}"
        backoff = 1
        while True:
            try:
                async with websockets.connect(url, ping_interval=15, ping_timeout=10,
                                              open_timeout=10) as up:
                    backoff = 1
                    async for raw in up:
                        p = json.loads(raw).get("data", {})
                        e = p.get("e")
                        if e == "kline":
                            kl = p["k"]
                            await self.push(k, {
                                "type": "kline", "exchange": "binance",
                                "symbol": symbol, "tf": tf,
                                "candle": {
                                    "time": int(kl["t"] // 1000),
                                    "open": float(kl["o"]), "high": float(kl["h"]),
                                    "low": float(kl["l"]), "close": float(kl["c"]),
                                    "volume": float(kl["v"]), "closed": kl["x"],
                                },
                            })
                        elif e == "aggTrade":
                            await self.push(k, {
                                "type": "trade", "exchange": "binance", "symbol": symbol,
                                "price": float(p["p"]), "qty": float(p["q"]),
                                "buyerMaker": p["m"], "time": int(p["T"]),
                            })
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def binance_futures_poller(self, symbol: str, mk: str):
        """Mark/Funding via fapi REST (3s). Liquidationen best-effort via fstream."""
        liq_task = asyncio.create_task(self._binance_liq_stream(symbol))
        try:
            async with httpx.AsyncClient() as client:
                while self._symbol_active("binance", symbol):
                    try:
                        prem = await fetch_json(client, f"{BN_FUT_REST}/premiumIndex",
                                                {"symbol": symbol})
                        mark = {
                            "price": float(prem["markPrice"]),
                            "funding": float(prem.get("lastFundingRate", 0)) * 100,
                            "nextFundingTime": int(prem.get("nextFundingTime", 0)),
                        }
                        self.last_mark[f"binance:{symbol}"] = mark
                        await self.push_symbol("binance", symbol,
                                               {"type": "mark", "exchange": "binance",
                                                "symbol": symbol, **mark})
                    except Exception:
                        pass
                    await asyncio.sleep(3)
        except asyncio.CancelledError:
            pass
        finally:
            liq_task.cancel()

    async def _binance_liq_stream(self, symbol: str):
        sym_l = symbol.lower()
        url = f"{BN_FUT_WS}?streams={sym_l}@forceOrder"
        try:
            async with websockets.connect(url, ping_interval=15, ping_timeout=10,
                                          open_timeout=8) as up:
                async for raw in up:
                    p = json.loads(raw).get("data", {})
                    if p.get("e") == "forceOrder":
                        o = p["o"]
                        liq = {"side": o["S"], "price": float(o["p"]),
                               "qty": float(o["q"]), "usd": float(o["p"]) * float(o["q"]),
                               "time": int(o["T"])}
                        self.liqs[f"binance:{symbol}"].appendleft(liq)
                        await self.push_symbol("binance", symbol,
                                               {"type": "liq", "exchange": "binance",
                                                "symbol": symbol, **liq})
        except (asyncio.CancelledError, Exception):
            pass  # fstream geblockt -> kein Live-Liq fuer Binance

    # ── Bybit Relay (alles in einem WS) ───────────────────────────────────────
    async def relay_bybit(self, symbol: str, tf: str, k: str):
        by_tf = BYBIT_TF.get(tf, "5")
        args = [f"kline.{by_tf}.{symbol}", f"tickers.{symbol}", f"allLiquidation.{symbol}"]
        backoff = 1
        while True:
            try:
                async with websockets.connect(BY_WS, ping_interval=20, ping_timeout=10,
                                              open_timeout=10) as up:
                    backoff = 1
                    await up.send(json.dumps({"op": "subscribe", "args": args}))
                    async for raw in up:
                        m = json.loads(raw)
                        topic = m.get("topic", "")
                        if topic.startswith("kline."):
                            for kl in m.get("data", []):
                                await self.push(k, {
                                    "type": "kline", "exchange": "bybit",
                                    "symbol": symbol, "tf": tf,
                                    "candle": {
                                        "time": int(kl["start"] // 1000),
                                        "open": float(kl["open"]), "high": float(kl["high"]),
                                        "low": float(kl["low"]), "close": float(kl["close"]),
                                        "volume": float(kl["volume"]), "closed": kl["confirm"],
                                    },
                                })
                        elif topic.startswith("tickers."):
                            d = m.get("data", {})
                            mark = {}
                            if d.get("markPrice"):
                                mark["price"] = float(d["markPrice"])
                            if d.get("fundingRate"):
                                mark["funding"] = float(d["fundingRate"]) * 100
                            if d.get("nextFundingTime"):
                                mark["nextFundingTime"] = int(d["nextFundingTime"])
                            if mark:
                                prev = self.last_mark.get(f"bybit:{symbol}", {})
                                prev.update(mark)
                                self.last_mark[f"bybit:{symbol}"] = prev
                                await self.push_symbol("bybit", symbol,
                                    {"type": "mark", "exchange": "bybit",
                                     "symbol": symbol, **prev})
                        elif topic.startswith("allLiquidation.") or topic.startswith("liquidation."):
                            data = m.get("data", [])
                            if isinstance(data, dict):
                                data = [data]
                            for o in data:
                                # Bybit side = Seite die liquidiert wurde.
                                # "Buy" = Short liquidiert, "Sell" = Long liquidiert
                                side_raw = o.get("side") or o.get("S", "")
                                price = float(o.get("price") or o.get("p", 0))
                                qty = float(o.get("size") or o.get("v") or o.get("q", 0))
                                liq = {
                                    "side": "SELL" if side_raw == "Sell" else "BUY",
                                    "price": price, "qty": qty, "usd": price * qty,
                                    "time": int(o.get("updatedTime") or o.get("T") or time.time()*1000),
                                }
                                self.liqs[f"bybit:{symbol}"].appendleft(liq)
                                await self.push_symbol("bybit", symbol,
                                    {"type": "liq", "exchange": "bybit",
                                     "symbol": symbol, **liq})
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)


hub = Hub()


# ══════════════════════════════════════════════════════════════════════════════
#  REST Proxies (exchange-aware)
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/klines")
async def api_klines(symbol: str = "BTCUSDT", tf: str = "5m",
                     limit: int = 500, exchange: str = "binance"):
    if tf not in TIMEFRAMES:
        return JSONResponse({"error": "invalid tf"}, status_code=400)
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/kline",
                                 {"category": "linear", "symbol": symbol,
                                  "interval": BYBIT_TF.get(tf, "5"), "limit": min(limit, 1000)})
            rows = d["result"]["list"]  # neueste zuerst -> umdrehen
            candles = [{
                "time": int(int(r[0]) // 1000), "open": float(r[1]), "high": float(r[2]),
                "low": float(r[3]), "close": float(r[4]), "volume": float(r[5]),
            } for r in reversed(rows)]
        else:
            data = await fetch_json(c, f"{BN_FUT_REST}/klines",
                                    {"symbol": symbol, "interval": tf, "limit": min(limit, 1500)})
            candles = [{
                "time": int(k[0] // 1000), "open": float(k[1]), "high": float(k[2]),
                "low": float(k[3]), "close": float(k[4]), "volume": float(k[5]),
            } for k in data]
    return JSONResponse(candles)


@app.get("/api/ticker")
async def api_ticker(symbol: str = "BTCUSDT", exchange: str = "binance"):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/tickers",
                                 {"category": "linear", "symbol": symbol})
            t = d["result"]["list"][0]
            price = float(t["lastPrice"])
            return JSONResponse({
                "symbol": symbol, "price": price,
                "change": float(t.get("price24hPcnt", 0)) * 100,
                "high": float(t["highPrice24h"]), "low": float(t["lowPrice24h"]),
                "volume": float(t["turnover24h"]), "oi": float(t.get("openInterest", 0)),
                "mark": float(t.get("markPrice", price) or price),
                "funding": float(t.get("fundingRate", 0) or 0) * 100,
                "nextFundingTime": int(t.get("nextFundingTime", 0) or 0),
            })
        else:
            t = await fetch_json(c, f"{BN_FUT_REST}/ticker/24hr", {"symbol": symbol})
            oi = await fetch_json(c, f"{BN_FUT_REST}/openInterest", {"symbol": symbol})
            mark = 0.0
            funding = 0.0
            next_ft = 0
            try:
                prem = await fetch_json(c, f"{BN_FUT_REST}/premiumIndex", {"symbol": symbol})
                mark = float(prem.get("markPrice", 0) or 0)
                funding = float(prem.get("lastFundingRate", 0) or 0) * 100
                next_ft = int(prem.get("nextFundingTime", 0) or 0)
            except Exception:
                pass
            return JSONResponse({
                "symbol": symbol, "price": float(t["lastPrice"]),
                "change": float(t["priceChangePercent"]),
                "high": float(t["highPrice"]), "low": float(t["lowPrice"]),
                "volume": float(t["quoteVolume"]), "oi": float(oi["openInterest"]),
                "mark": mark or float(t["lastPrice"]),
                "funding": funding,
                "nextFundingTime": next_ft,
            })


@app.get("/api/tickers")
async def api_tickers(exchange: str = "binance"):
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/tickers", {"category": "linear"})
            by = {t["symbol"]: t for t in d["result"]["list"]}
            out = []
            for s in DEFAULT_SYMBOLS:
                t = by.get(s)
                if t:
                    out.append({"symbol": s, "price": float(t["lastPrice"]),
                                "change": float(t.get("price24hPcnt", 0)) * 100,
                                "volume": float(t["turnover24h"])})
            return JSONResponse(out)
        else:
            all_t = await fetch_json(c, f"{BN_FUT_REST}/ticker/24hr")
            wanted = {s: None for s in DEFAULT_SYMBOLS}
            for t in all_t:
                if t["symbol"] in wanted:
                    wanted[t["symbol"]] = {"symbol": t["symbol"], "price": float(t["lastPrice"]),
                                           "change": float(t["priceChangePercent"]),
                                           "volume": float(t["quoteVolume"])}
            return JSONResponse([v for v in wanted.values() if v])


@app.get("/api/oi_hist")
async def api_oi_hist(symbol: str = "BTCUSDT", period: str = "1h",
                      limit: int = 100, exchange: str = "binance"):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            by_int = {"5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d"}.get(period, "1h")
            d = await fetch_json(c, f"{BY_REST}/market/open-interest",
                                 {"category": "linear", "symbol": symbol,
                                  "intervalTime": by_int, "limit": min(limit, 200)})
            rows = d["result"]["list"]
            # Bybit OI ist in Basis-Einheiten -> mit Preis multiplizieren waere noetig,
            # hier liefern wir Basis-OI direkt (Trend zaehlt)
            return JSONResponse([{
                "time": int(int(r["timestamp"]) // 1000), "value": float(r["openInterest"]),
                "base": float(r["openInterest"]),
            } for r in reversed(rows)])
        else:
            data = await fetch_json(c, f"{BN_FUT_DATA}/openInterestHist",
                                    {"symbol": symbol, "period": period, "limit": min(limit, 500)})
            return JSONResponse([{
                "time": int(d2["timestamp"] // 1000), "value": float(d2["sumOpenInterestValue"]),
                "base": float(d2["sumOpenInterest"]),
            } for d2 in data])


@app.get("/api/funding_hist")
async def api_funding_hist(symbol: str = "BTCUSDT", limit: int = 100, exchange: str = "binance"):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/funding/history",
                                 {"category": "linear", "symbol": symbol, "limit": min(limit, 200)})
            rows = d["result"]["list"]
            return JSONResponse([{
                "time": int(int(r["fundingRateTimestamp"]) // 1000),
                "value": float(r["fundingRate"]) * 100,
            } for r in reversed(rows)])
        else:
            data = await fetch_json(c, f"{BN_FUT_REST}/fundingRate",
                                    {"symbol": symbol, "limit": min(limit, 1000)})
            return JSONResponse([{
                "time": int(d2["fundingTime"] // 1000), "value": float(d2["fundingRate"]) * 100,
            } for d2 in data])


@app.get("/api/ls_hist")
async def api_ls_hist(symbol: str = "BTCUSDT", period: str = "1h",
                      limit: int = 100, exchange: str = "binance"):
    """Long/Short Ratio. Bybit hat keinen direkten Endpoint -> Binance als Fallback."""
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        try:
            glob = await fetch_json(c, f"{BN_FUT_DATA}/globalLongShortAccountRatio",
                                    {"symbol": symbol, "period": period, "limit": min(limit, 500)})
            top = await fetch_json(c, f"{BN_FUT_DATA}/topLongShortPositionRatio",
                                   {"symbol": symbol, "period": period, "limit": min(limit, 500)})
            return JSONResponse({
                "global": [{"time": int(d["timestamp"]//1000), "long": float(d["longAccount"])*100,
                            "ratio": float(d["longShortRatio"])} for d in glob],
                "top": [{"time": int(d["timestamp"]//1000), "long": float(d["longAccount"])*100,
                         "ratio": float(d["longShortRatio"])} for d in top],
            })
        except Exception:
            return JSONResponse({"global": [], "top": []})


@app.get("/api/liquidations")
async def api_liquidations(symbol: str = "BTCUSDT", exchange: str = "binance"):
    return JSONResponse(list(hub.liqs.get(f"{exchange}:{symbol.upper()}", [])))


@app.get("/api/symbols")
async def api_symbols():
    return JSONResponse({"symbols": DEFAULT_SYMBOLS, "timeframes": TIMEFRAMES,
                         "exchanges": EXCHANGES})


# ── CVD (Cumulative Volume Delta) ─────────────────────────────────────────────
@app.get("/api/cvd")
async def api_cvd(symbol: str = "BTCUSDT", tf: str = "5m",
                  limit: int = 300, exchange: str = "binance"):
    """
    Kumulatives Volumen-Delta. Binance-Klines enthalten taker-buy-Volumen
    (Index 9) -> echtes Delta = 2*takerBuy - totalVol. Binance ist die
    Referenz-Boerse fuer Orderflow (tiefste Liquiditaet), daher immer Binance.
    """
    symbol = symbol.upper()
    if tf not in TIMEFRAMES:
        return JSONResponse({"error": "invalid tf"}, status_code=400)
    async with httpx.AsyncClient() as c:
        data = await fetch_json(c, f"{BN_FUT_REST}/klines",
                                {"symbol": symbol, "interval": tf, "limit": min(limit, 1000)})
    out = []
    cvd = 0.0
    for k in data:
        vol = float(k[5])
        taker_buy = float(k[9])
        delta = 2 * taker_buy - vol          # buy_vol - sell_vol
        cvd += delta
        out.append({"time": int(k[0] // 1000), "delta": delta, "cvd": cvd})
    return JSONResponse(out)


# ── Volume Profile (Volume by Price + POC / VAH / VAL) ────────────────────────
@app.get("/api/volume_profile")
async def api_volume_profile(symbol: str = "BTCUSDT", tf: str = "5m",
                             limit: int = 300, exchange: str = "binance",
                             bins: int = 60):
    """
    Verteilt das Volumen jeder Kerze gleichmaessig ueber ihre High-Low-Spanne
    auf Preis-Bins. POC = Bin mit hoechstem Volumen. Value Area = 70% des
    Gesamtvolumens um den POC (VAH oben, VAL unten).
    """
    symbol = symbol.upper()
    bins = max(20, min(bins, 150))
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/kline",
                                 {"category": "linear", "symbol": symbol,
                                  "interval": BYBIT_TF.get(tf, "5"), "limit": min(limit, 1000)})
            rows = list(reversed(d["result"]["list"]))
            candles = [(float(r[2]), float(r[3]), float(r[5])) for r in rows]  # high, low, vol
        else:
            data = await fetch_json(c, f"{BN_FUT_REST}/klines",
                                    {"symbol": symbol, "interval": tf, "limit": min(limit, 1000)})
            candles = [(float(k[2]), float(k[3]), float(k[5])) for k in data]  # high, low, vol

    if not candles:
        return JSONResponse({"bins": [], "poc": None, "vah": None, "val": None})

    lo = min(c[1] for c in candles)
    hi = max(c[0] for c in candles)
    if hi <= lo:
        hi = lo + 1
    bin_size = (hi - lo) / bins
    vols = [0.0] * bins

    for high, low, vol in candles:
        if vol <= 0:
            continue
        i_lo = int((low - lo) / bin_size)
        i_hi = int((high - lo) / bin_size)
        i_lo = max(0, min(i_lo, bins - 1))
        i_hi = max(0, min(i_hi, bins - 1))
        span = i_hi - i_lo + 1
        share = vol / span
        for i in range(i_lo, i_hi + 1):
            vols[i] += share

    total = sum(vols)
    poc_idx = max(range(bins), key=lambda i: vols[i])
    poc_price = lo + (poc_idx + 0.5) * bin_size

    # Value Area: ab POC nach aussen wachsen bis 70% erreicht
    target = total * 0.70
    acc = vols[poc_idx]
    lo_i = hi_i = poc_idx
    while acc < target and (lo_i > 0 or hi_i < bins - 1):
        below = vols[lo_i - 1] if lo_i > 0 else -1
        above = vols[hi_i + 1] if hi_i < bins - 1 else -1
        if above >= below:
            hi_i += 1; acc += vols[hi_i]
        else:
            lo_i -= 1; acc += vols[lo_i]

    val_price = lo + lo_i * bin_size
    vah_price = lo + (hi_i + 1) * bin_size

    bins_out = [{"price": lo + (i + 0.5) * bin_size, "vol": vols[i]} for i in range(bins)]
    return JSONResponse({
        "bins": bins_out, "poc": poc_price,
        "vah": vah_price, "val": val_price,
        "binSize": bin_size, "maxVol": max(vols) if vols else 0,
    })


# ── Orderbook (Bid/Ask Tiefe) ─────────────────────────────────────────────────
@app.get("/api/orderbook")
async def api_orderbook(symbol: str = "BTCUSDT", exchange: str = "binance", limit: int = 50):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            by_limit = min(max(limit, 1), 200)
            d = await fetch_json(c, f"{BY_REST}/market/orderbook",
                                 {"category": "linear", "symbol": symbol, "limit": by_limit})
            r = d["result"]
            bids = [[float(p), float(q)] for p, q in r.get("b", [])]
            asks = [[float(p), float(q)] for p, q in r.get("a", [])]
        else:
            bn_limit = 50 if limit <= 50 else 100 if limit <= 100 else 500
            d = await fetch_json(c, f"{BN_FUT_REST}/depth", {"symbol": symbol, "limit": bn_limit})
            bids = [[float(p), float(q)] for p, q in d.get("bids", [])]
            asks = [[float(p), float(q)] for p, q in d.get("asks", [])]
    bids = bids[:limit]
    asks = asks[:limit]
    bid_sum = sum(q for _, q in bids)
    ask_sum = sum(q for _, q in asks)
    return JSONResponse({
        "bids": bids, "asks": asks,
        "bidSum": bid_sum, "askSum": ask_sum,
        "imbalance": (bid_sum - ask_sum) / (bid_sum + ask_sum) if (bid_sum + ask_sum) else 0,
    })


# ══════════════════════════════════════════════════════════════════════════════
#  KI-Assistent
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/ai/health")
async def ai_health():
    return JSONResponse({"ok": bool(ai.load_anthropic_key()), "model": ai.ANTHROPIC_MODEL})


@app.get("/api/ai/analyze")
async def ai_analyze(symbol: str = "BTCUSDT", tf: str = "5m",
                     exchange: str = "binance", question: str = ""):
    """SSE-Stream: sammelt Snapshot + streamt Claude-Analyse."""
    async def gen():
        try:
            snap = await ai.gather_snapshot(symbol, tf, exchange)
            liq_sum = ai.liquidation_summary(hub, exchange, symbol)
            # Snapshot vorab als Event (Frontend kann ihn anzeigen)
            yield f"event: snapshot\ndata: {json.dumps(snap)}\n\n"
            async for chunk in ai.stream_analysis(snap, liq_sum, question or None):
                # SSE: Zeilenumbrueche in Daten escapen
                safe = chunk.replace("\r", "")
                payload = json.dumps({"t": safe})
                yield f"event: chunk\ndata: {payload}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'msg': str(e)[:200]})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ══════════════════════════════════════════════════════════════════════════════
#  WebSocket Endpoint
# ══════════════════════════════════════════════════════════════════════════════
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_json()
            action = msg.get("action")
            if action == "subscribe":
                ex = msg.get("exchange", "binance")
                symbol = msg.get("symbol", "BTCUSDT").upper()
                tf = msg.get("tf", "5m")
                hub.unsubscribe(ws)
                await hub.subscribe(ws, ex, symbol, tf)
                mk = f"{ex}:{symbol}"
                if mk in hub.last_mark:
                    await ws.send_json({"type": "mark", "exchange": ex,
                                        "symbol": symbol, **hub.last_mark[mk]})
                await ws.send_json({"type": "subscribed", "exchange": ex,
                                    "symbol": symbol, "tf": tf})
            elif action == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.unsubscribe(ws)


# ══════════════════════════════════════════════════════════════════════════════
#  Static & Routen
# ══════════════════════════════════════════════════════════════════════════════
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(
        (STATIC_DIR / "app.html").read_text(),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate",
                 "Pragma": "no-cache", "Expires": "0"},
    )


@app.get("/classic", response_class=HTMLResponse)
async def classic():
    return HTMLResponse((STATIC_DIR / "classic.html").read_text())


@app.get("/guide", response_class=HTMLResponse)
async def guide():
    return HTMLResponse((STATIC_DIR / "guide.html").read_text())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server_v2:app", host="0.0.0.0", port=7777, reload=False)
