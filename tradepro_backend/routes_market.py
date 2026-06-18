import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .config import BN_FUT_DATA, BN_FUT_REST, BY_REST, BYBIT_TF, DEFAULT_SYMBOLS, EXCHANGES, TIMEFRAMES
from .http_client import fetch_json
from .state import hub

router = APIRouter(prefix="/api")


@router.get("/klines")
async def api_klines(symbol: str = "BTCUSDT", tf: str = "5m", limit: int = 500, exchange: str = "binance"):
    if tf not in TIMEFRAMES:
        return JSONResponse({"error": "invalid tf"}, status_code=400)
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/kline", {"category": "linear", "symbol": symbol, "interval": BYBIT_TF.get(tf, "5"), "limit": min(limit, 1000)})
            rows = d["result"]["list"]
            candles = [
                {
                    "time": int(int(r[0]) // 1000),
                    "open": float(r[1]),
                    "high": float(r[2]),
                    "low": float(r[3]),
                    "close": float(r[4]),
                    "volume": float(r[5]),
                }
                for r in reversed(rows)
            ]
        else:
            data = await fetch_json(c, f"{BN_FUT_REST}/klines", {"symbol": symbol, "interval": tf, "limit": min(limit, 1500)})
            candles = [
                {
                    "time": int(k[0] // 1000),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                }
                for k in data
            ]
    return JSONResponse(candles)


@router.get("/ticker")
async def api_ticker(symbol: str = "BTCUSDT", exchange: str = "binance"):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/tickers", {"category": "linear", "symbol": symbol})
            t = d["result"]["list"][0]
            price = float(t["lastPrice"])
            return JSONResponse(
                {
                    "symbol": symbol,
                    "price": price,
                    "change": float(t.get("price24hPcnt", 0)) * 100,
                    "high": float(t["highPrice24h"]),
                    "low": float(t["lowPrice24h"]),
                    "volume": float(t["turnover24h"]),
                    "oi": float(t.get("openInterest", 0)),
                    "mark": float(t.get("markPrice", price) or price),
                    "funding": float(t.get("fundingRate", 0) or 0) * 100,
                    "nextFundingTime": int(t.get("nextFundingTime", 0) or 0),
                }
            )

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
        return JSONResponse(
            {
                "symbol": symbol,
                "price": float(t["lastPrice"]),
                "change": float(t["priceChangePercent"]),
                "high": float(t["highPrice"]),
                "low": float(t["lowPrice"]),
                "volume": float(t["quoteVolume"]),
                "oi": float(oi["openInterest"]),
                "mark": mark or float(t["lastPrice"]),
                "funding": funding,
                "nextFundingTime": next_ft,
            }
        )


@router.get("/tickers")
async def api_tickers(exchange: str = "binance"):
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/tickers", {"category": "linear"})
            by = {t["symbol"]: t for t in d["result"]["list"]}
            out = []
            for s in DEFAULT_SYMBOLS:
                t = by.get(s)
                if t:
                    out.append({"symbol": s, "price": float(t["lastPrice"]), "change": float(t.get("price24hPcnt", 0)) * 100, "volume": float(t["turnover24h"])})
            return JSONResponse(out)

        all_t = await fetch_json(c, f"{BN_FUT_REST}/ticker/24hr")
        wanted = {s: None for s in DEFAULT_SYMBOLS}
        for t in all_t:
            if t["symbol"] in wanted:
                wanted[t["symbol"]] = {"symbol": t["symbol"], "price": float(t["lastPrice"]), "change": float(t["priceChangePercent"]), "volume": float(t["quoteVolume"])}
        return JSONResponse([v for v in wanted.values() if v])


@router.get("/oi_hist")
async def api_oi_hist(symbol: str = "BTCUSDT", period: str = "1h", limit: int = 100, exchange: str = "binance"):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            by_int = {"5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1d"}.get(period, "1h")
            d = await fetch_json(c, f"{BY_REST}/market/open-interest", {"category": "linear", "symbol": symbol, "intervalTime": by_int, "limit": min(limit, 200)})
            rows = d["result"]["list"]
            return JSONResponse([{"time": int(int(r["timestamp"]) // 1000), "value": float(r["openInterest"]), "base": float(r["openInterest"])} for r in reversed(rows)])

        data = await fetch_json(c, f"{BN_FUT_DATA}/openInterestHist", {"symbol": symbol, "period": period, "limit": min(limit, 500)})
        return JSONResponse([{"time": int(d2["timestamp"] // 1000), "value": float(d2["sumOpenInterestValue"]), "base": float(d2["sumOpenInterest"])} for d2 in data])


@router.get("/funding_hist")
async def api_funding_hist(symbol: str = "BTCUSDT", limit: int = 100, exchange: str = "binance"):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/funding/history", {"category": "linear", "symbol": symbol, "limit": min(limit, 200)})
            rows = d["result"]["list"]
            return JSONResponse([{"time": int(int(r["fundingRateTimestamp"]) // 1000), "value": float(r["fundingRate"]) * 100} for r in reversed(rows)])

        data = await fetch_json(c, f"{BN_FUT_REST}/fundingRate", {"symbol": symbol, "limit": min(limit, 1000)})
        return JSONResponse([{"time": int(d2["fundingTime"] // 1000), "value": float(d2["fundingRate"]) * 100} for d2 in data])


@router.get("/ls_hist")
async def api_ls_hist(symbol: str = "BTCUSDT", period: str = "1h", limit: int = 100, exchange: str = "binance"):
    _ = exchange
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        try:
            glob = await fetch_json(c, f"{BN_FUT_DATA}/globalLongShortAccountRatio", {"symbol": symbol, "period": period, "limit": min(limit, 500)})
            top = await fetch_json(c, f"{BN_FUT_DATA}/topLongShortPositionRatio", {"symbol": symbol, "period": period, "limit": min(limit, 500)})
            return JSONResponse(
                {
                    "global": [{"time": int(d["timestamp"] // 1000), "long": float(d["longAccount"]) * 100, "ratio": float(d["longShortRatio"])} for d in glob],
                    "top": [{"time": int(d["timestamp"] // 1000), "long": float(d["longAccount"]) * 100, "ratio": float(d["longShortRatio"])} for d in top],
                }
            )
        except Exception:
            return JSONResponse({"global": [], "top": []})


@router.get("/liquidations")
async def api_liquidations(symbol: str = "BTCUSDT", exchange: str = "binance"):
    return JSONResponse(list(hub.liqs.get(f"{exchange}:{symbol.upper()}", [])))


@router.get("/symbols")
async def api_symbols():
    return JSONResponse({"symbols": DEFAULT_SYMBOLS, "timeframes": TIMEFRAMES, "exchanges": EXCHANGES})


@router.get("/cvd")
async def api_cvd(symbol: str = "BTCUSDT", tf: str = "5m", limit: int = 300, exchange: str = "binance"):
    _ = exchange
    symbol = symbol.upper()
    if tf not in TIMEFRAMES:
        return JSONResponse({"error": "invalid tf"}, status_code=400)
    async with httpx.AsyncClient() as c:
        data = await fetch_json(c, f"{BN_FUT_REST}/klines", {"symbol": symbol, "interval": tf, "limit": min(limit, 1000)})
    out = []
    cvd = 0.0
    for k in data:
        vol = float(k[5])
        taker_buy = float(k[9])
        delta = 2 * taker_buy - vol
        cvd += delta
        out.append({"time": int(k[0] // 1000), "delta": delta, "cvd": cvd})
    return JSONResponse(out)


@router.get("/volume_profile")
async def api_volume_profile(symbol: str = "BTCUSDT", tf: str = "5m", limit: int = 300, exchange: str = "binance", bins: int = 60):
    symbol = symbol.upper()
    bins = max(20, min(bins, 150))
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            d = await fetch_json(c, f"{BY_REST}/market/kline", {"category": "linear", "symbol": symbol, "interval": BYBIT_TF.get(tf, "5"), "limit": min(limit, 1000)})
            rows = list(reversed(d["result"]["list"]))
            candles = [(float(r[2]), float(r[3]), float(r[5])) for r in rows]
        else:
            data = await fetch_json(c, f"{BN_FUT_REST}/klines", {"symbol": symbol, "interval": tf, "limit": min(limit, 1000)})
            candles = [(float(k[2]), float(k[3]), float(k[5])) for k in data]

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

    target = total * 0.70
    acc = vols[poc_idx]
    lo_i = hi_i = poc_idx
    while acc < target and (lo_i > 0 or hi_i < bins - 1):
        below = vols[lo_i - 1] if lo_i > 0 else -1
        above = vols[hi_i + 1] if hi_i < bins - 1 else -1
        if above >= below:
            hi_i += 1
            acc += vols[hi_i]
        else:
            lo_i -= 1
            acc += vols[lo_i]

    val_price = lo + lo_i * bin_size
    vah_price = lo + (hi_i + 1) * bin_size

    bins_out = [{"price": lo + (i + 0.5) * bin_size, "vol": vols[i]} for i in range(bins)]
    return JSONResponse({"bins": bins_out, "poc": poc_price, "vah": vah_price, "val": val_price, "binSize": bin_size, "maxVol": max(vols) if vols else 0})


@router.get("/orderbook")
async def api_orderbook(symbol: str = "BTCUSDT", exchange: str = "binance", limit: int = 50):
    symbol = symbol.upper()
    async with httpx.AsyncClient() as c:
        if exchange == "bybit":
            by_limit = min(max(limit, 1), 200)
            d = await fetch_json(c, f"{BY_REST}/market/orderbook", {"category": "linear", "symbol": symbol, "limit": by_limit})
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
    return JSONResponse({"bids": bids, "asks": asks, "bidSum": bid_sum, "askSum": ask_sum, "imbalance": (bid_sum - ask_sum) / (bid_sum + ask_sum) if (bid_sum + ask_sum) else 0})
