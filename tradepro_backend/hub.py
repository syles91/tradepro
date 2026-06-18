import asyncio
import json
import time
from collections import defaultdict, deque
from typing import Dict, Set

import httpx
import websockets
from fastapi import WebSocket

from .config import BN_FUT_REST, BN_FUT_WS, BN_SPOT_WS, BY_WS, BYBIT_TF
from .http_client import fetch_json


class Hub:
    def __init__(self):
        self.subs: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.tasks: Dict[str, asyncio.Task] = {}
        self.last_mark: Dict[str, dict] = {}
        self.liqs: Dict[str, deque] = defaultdict(lambda: deque(maxlen=50))

    def key(self, ex: str, symbol: str, tf: str) -> str:
        return f"{ex}:{symbol.upper()}@{tf}"

    def meta_key(self, ex: str, symbol: str) -> str:
        return f"META:{ex}:{symbol.upper()}"

    async def subscribe(self, ws: WebSocket, ex: str, symbol: str, tf: str):
        symbol = symbol.upper()
        k = self.key(ex, symbol, tf)
        self.subs[k].add(ws)
        if k not in self.tasks or self.tasks[k].done():
            if ex == "bybit":
                self.tasks[k] = asyncio.create_task(self.relay_bybit(symbol, tf, k))
            else:
                self.tasks[k] = asyncio.create_task(self.relay_binance(symbol, tf, k))
        if ex == "binance":
            mk = self.meta_key(ex, symbol)
            if mk not in self.tasks or self.tasks[mk].done():
                self.tasks[mk] = asyncio.create_task(self.binance_futures_poller(symbol))

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

    async def relay_binance(self, symbol: str, tf: str, k: str):
        sym_l = symbol.lower()
        streams = f"{sym_l}@kline_{tf}/{sym_l}@aggTrade"
        url = f"{BN_SPOT_WS}?streams={streams}"
        backoff = 1
        while True:
            try:
                async with websockets.connect(url, ping_interval=15, ping_timeout=10, open_timeout=10) as up:
                    backoff = 1
                    async for raw in up:
                        p = json.loads(raw).get("data", {})
                        e = p.get("e")
                        if e == "kline":
                            kl = p["k"]
                            await self.push(
                                k,
                                {
                                    "type": "kline",
                                    "exchange": "binance",
                                    "symbol": symbol,
                                    "tf": tf,
                                    "candle": {
                                        "time": int(kl["t"] // 1000),
                                        "open": float(kl["o"]),
                                        "high": float(kl["h"]),
                                        "low": float(kl["l"]),
                                        "close": float(kl["c"]),
                                        "volume": float(kl["v"]),
                                        "closed": kl["x"],
                                    },
                                },
                            )
                        elif e == "aggTrade":
                            await self.push(
                                k,
                                {
                                    "type": "trade",
                                    "exchange": "binance",
                                    "symbol": symbol,
                                    "price": float(p["p"]),
                                    "qty": float(p["q"]),
                                    "buyerMaker": p["m"],
                                    "time": int(p["T"]),
                                },
                            )
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def binance_futures_poller(self, symbol: str):
        liq_task = asyncio.create_task(self._binance_liq_stream(symbol))
        try:
            async with httpx.AsyncClient() as client:
                while self._symbol_active("binance", symbol):
                    try:
                        prem = await fetch_json(client, f"{BN_FUT_REST}/premiumIndex", {"symbol": symbol})
                        mark = {
                            "price": float(prem["markPrice"]),
                            "funding": float(prem.get("lastFundingRate", 0)) * 100,
                            "nextFundingTime": int(prem.get("nextFundingTime", 0)),
                        }
                        self.last_mark[f"binance:{symbol}"] = mark
                        await self.push_symbol(
                            "binance",
                            symbol,
                            {"type": "mark", "exchange": "binance", "symbol": symbol, **mark},
                        )
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
            async with websockets.connect(url, ping_interval=15, ping_timeout=10, open_timeout=8) as up:
                async for raw in up:
                    p = json.loads(raw).get("data", {})
                    if p.get("e") == "forceOrder":
                        o = p["o"]
                        liq = {
                            "side": o["S"],
                            "price": float(o["p"]),
                            "qty": float(o["q"]),
                            "usd": float(o["p"]) * float(o["q"]),
                            "time": int(o["T"]),
                        }
                        self.liqs[f"binance:{symbol}"].appendleft(liq)
                        await self.push_symbol(
                            "binance",
                            symbol,
                            {"type": "liq", "exchange": "binance", "symbol": symbol, **liq},
                        )
        except (asyncio.CancelledError, Exception):
            pass

    async def relay_bybit(self, symbol: str, tf: str, k: str):
        by_tf = BYBIT_TF.get(tf, "5")
        args = [f"kline.{by_tf}.{symbol}", f"tickers.{symbol}", f"allLiquidation.{symbol}"]
        backoff = 1
        while True:
            try:
                async with websockets.connect(BY_WS, ping_interval=20, ping_timeout=10, open_timeout=10) as up:
                    backoff = 1
                    await up.send(json.dumps({"op": "subscribe", "args": args}))
                    async for raw in up:
                        m = json.loads(raw)
                        topic = m.get("topic", "")
                        if topic.startswith("kline."):
                            for kl in m.get("data", []):
                                await self.push(
                                    k,
                                    {
                                        "type": "kline",
                                        "exchange": "bybit",
                                        "symbol": symbol,
                                        "tf": tf,
                                        "candle": {
                                            "time": int(kl["start"] // 1000),
                                            "open": float(kl["open"]),
                                            "high": float(kl["high"]),
                                            "low": float(kl["low"]),
                                            "close": float(kl["close"]),
                                            "volume": float(kl["volume"]),
                                            "closed": kl["confirm"],
                                        },
                                    },
                                )
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
                                await self.push_symbol(
                                    "bybit",
                                    symbol,
                                    {"type": "mark", "exchange": "bybit", "symbol": symbol, **prev},
                                )
                        elif topic.startswith("allLiquidation.") or topic.startswith("liquidation."):
                            data = m.get("data", [])
                            if isinstance(data, dict):
                                data = [data]
                            for o in data:
                                side_raw = o.get("side") or o.get("S", "")
                                price = float(o.get("price") or o.get("p", 0))
                                qty = float(o.get("size") or o.get("v") or o.get("q", 0))
                                liq = {
                                    "side": "SELL" if side_raw == "Sell" else "BUY",
                                    "price": price,
                                    "qty": qty,
                                    "usd": price * qty,
                                    "time": int(o.get("updatedTime") or o.get("T") or time.time() * 1000),
                                }
                                self.liqs[f"bybit:{symbol}"].appendleft(liq)
                                await self.push_symbol(
                                    "bybit",
                                    symbol,
                                    {"type": "liq", "exchange": "bybit", "symbol": symbol, **liq},
                                )
            except asyncio.CancelledError:
                break
            except Exception:
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
