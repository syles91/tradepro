from tradepro.core import database as db
from tradepro.market.service import build_context
from tradepro.strategies import DEFAULT_STRATEGIES

class SignalEngine:
    def __init__(self, strategies=None, hub=None):
        self.strategies = strategies or DEFAULT_STRATEGIES
        self.hub = hub
        db.migrate()
        for s in self.strategies:
            db.upsert_strategy({"id":s.id,"name":s.name,"description":s.description,"default_config":getattr(s,"default_config",{})})

    async def evaluate(self, symbol="BTCUSDT", tf="5m", exchange="binance", persist=True):
        ctx = await build_context(symbol, tf, exchange, self.hub)
        signals=[]
        for s in self.strategies:
            if not db.strategy_enabled(s.id): continue
            try:
                sig = await s.evaluate(ctx)
                if sig.status != "neutral":
                    d=sig.to_dict(); signals.append(d)
                    if persist: db.save_signal(d)
            except Exception as e:
                signals.append({"strategy_id":s.id,"strategy_name":s.name,"symbol":ctx.symbol,"exchange":exchange,"timeframe":tf,"side":"neutral","confidence":0,"status":"error","reasons":[],"warnings":[str(e)[:160]],"created_at":0,"id":f"error-{s.id}"})
        signals.sort(key=lambda x: x.get("confidence",0), reverse=True)
        return {"symbol":ctx.symbol,"exchange":exchange,"timeframe":tf,"price":ctx.price,"signals":signals,"context":{"rsi":round(ctx.indicators.get("rsi",0),1),"ema20":round(ctx.indicators.get("ema20",0),4),"ema50":round(ctx.indicators.get("ema50",0),4),"ema200":round(ctx.indicators.get("ema200",0),4),"atr":round(ctx.indicators.get("atr",0),4),"funding":ctx.ticker.get("funding"),"oi_usd":ctx.ticker.get("oi")}}
