import httpx
from tradepro.core.config import BN_FUT_REST, BN_FUT_DATA, BY_REST, BYBIT_TF
from tradepro.core.models import Candle, MarketContext
from tradepro.indicators import ema, rsi, macd, atr, volume_ratio

async def _get(client, url, params=None):
    r = await client.get(url, params=params, timeout=12)
    r.raise_for_status()
    return r.json()

async def load_candles(client, symbol, tf, exchange, limit=500):
    symbol=symbol.upper()
    if exchange == "bybit":
        d = await _get(client, f"{BY_REST}/market/kline", {"category":"linear","symbol":symbol,"interval":BYBIT_TF.get(tf,"5"),"limit":min(limit,1000)})
        rows=list(reversed(d["result"]["list"]))
        return [Candle(int(int(r[0])//1000), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])) for r in rows]
    d = await _get(client, f"{BN_FUT_REST}/klines", {"symbol":symbol,"interval":tf,"limit":min(limit,1500)})
    return [Candle(int(k[0]//1000), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])) for k in d]

async def load_ticker(client, symbol, exchange):
    symbol=symbol.upper()
    if exchange == "bybit":
        d=await _get(client, f"{BY_REST}/market/tickers", {"category":"linear","symbol":symbol})
        t=d["result"]["list"][0]; price=float(t["lastPrice"])
        return {"price":price,"change":float(t.get("price24hPcnt",0))*100,"volume":float(t.get("turnover24h",0)),"oi":float(t.get("openInterest",0))*price,"mark":float(t.get("markPrice",price) or price),"funding":float(t.get("fundingRate",0) or 0)*100,"nextFundingTime":int(t.get("nextFundingTime",0) or 0)}
    t=await _get(client, f"{BN_FUT_REST}/ticker/24hr", {"symbol":symbol})
    oi=await _get(client, f"{BN_FUT_REST}/openInterest", {"symbol":symbol})
    prem={}
    try: prem=await _get(client, f"{BN_FUT_REST}/premiumIndex", {"symbol":symbol})
    except Exception: pass
    price=float(t["lastPrice"])
    return {"price":price,"change":float(t["priceChangePercent"]),"volume":float(t["quoteVolume"]),"oi":float(oi["openInterest"])*price,"mark":float(prem.get("markPrice",price) or price),"funding":float(prem.get("lastFundingRate",0) or 0)*100,"nextFundingTime":int(prem.get("nextFundingTime",0) or 0)}

async def build_context(symbol="BTCUSDT", tf="5m", exchange="binance", hub=None):
    symbol=symbol.upper()
    async with httpx.AsyncClient() as c:
        candles = await load_candles(c, symbol, tf, exchange, 500)
        ticker = await load_ticker(c, symbol, exchange)
        async def safe(coro, default):
            try: return await coro
            except Exception: return default
        period = {"1m":"5m","3m":"5m","5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d"}.get(tf,"1h")
        oi_hist = await safe(_get(c, f"{BN_FUT_DATA}/openInterestHist", {"symbol":symbol,"period":period,"limit":100}), [])
        funding_hist = await safe(_get(c, f"{BN_FUT_REST}/fundingRate", {"symbol":symbol,"limit":100}), [])
        glob = await safe(_get(c, f"{BN_FUT_DATA}/globalLongShortAccountRatio", {"symbol":symbol,"period":period,"limit":20}), [])
        top = await safe(_get(c, f"{BN_FUT_DATA}/topLongShortPositionRatio", {"symbol":symbol,"period":period,"limit":20}), [])
        cvd = await safe(_get(c, f"{BN_FUT_REST}/klines", {"symbol":symbol,"interval":tf,"limit":80}), [])
        ob = await safe(( _get(c, f"{BY_REST}/market/orderbook", {"category":"linear","symbol":symbol,"limit":50}) if exchange=="bybit" else _get(c, f"{BN_FUT_REST}/depth", {"symbol":symbol,"limit":50}) ), {})
    closes=[x.close for x in candles]
    indicators={"rsi": rsi(closes), "macd": macd(closes), "atr": atr(candles), "vol_ratio": volume_ratio(candles)}
    for p in (20,50,200):
        indicators[f"ema{p}"] = ema(closes, p)[-1] if closes else 0
    cvd_points=[]; acc=0.0
    for k in cvd:
        vol=float(k[5]); delta=2*float(k[9])-vol; acc += delta; cvd_points.append({"time":int(k[0]//1000),"delta":delta,"cvd":acc})
    liqs=[]
    if hub is not None:
        try: liqs=list(hub.liqs.get(f"{exchange}:{symbol}", []))
        except Exception: pass
    return MarketContext(symbol=symbol, exchange=exchange, timeframe=tf, candles=candles, ticker=ticker, oi_hist=oi_hist, funding_hist=funding_hist, ls_hist={"global":glob,"top":top}, cvd=cvd_points, orderbook=ob, liquidations=liqs, indicators=indicators)
