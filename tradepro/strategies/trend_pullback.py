from .base import StrategyBase
from tradepro.core.models import SignalResult

class TrendPullback(StrategyBase):
    id = "trend_pullback"
    name = "Trend Pullback"
    description = "EMA20/50/200 Trendfilter + RSI/MACD Pullback-Reclaim."
    default_config = {"min_confirmed": 65, "min_watch": 45, "atr_stop": 1.4, "rr_targets": [1.5, 2.5]}

    async def evaluate(self, ctx):
        ind=ctx.indicators; price=ctx.price; atr=ind.get("atr", 0) or price*0.006
        e20,e50,e200=ind.get("ema20",0),ind.get("ema50",0),ind.get("ema200",0)
        rsi=ind.get("rsi",50); macd=ind.get("macd",{}); volr=ind.get("vol_ratio",1)
        funding=ctx.ticker.get("funding",0); score=0; reasons=[]; warnings=[]
        long_bias = price>e200 and e20>e50
        short_bias = price<e200 and e20<e50
        side="neutral"
        if long_bias:
            side="long"; score+=30; reasons.append("Trend bullish: Preis über EMA200 und EMA20 > EMA50")
            if price <= e20*1.01: score+=15; reasons.append("Pullback nahe EMA20")
            if rsi >= 48: score+=15; reasons.append(f"RSI reclaim/Support ({rsi:.1f})")
            if macd.get("hist",0) > 0: score+=15; reasons.append("MACD Histogram positiv")
            if volr >= 1.15: score+=10; reasons.append(f"Volumen bestätigt ({volr:.1f}x)")
            if funding > 0.06: score-=8; warnings.append(f"Funding erhöht ({funding:+.4f}%)")
        elif short_bias:
            side="short"; score+=30; reasons.append("Trend bearish: Preis unter EMA200 und EMA20 < EMA50")
            if price >= e20*0.99: score+=15; reasons.append("Pullback nahe EMA20 von unten")
            if rsi <= 52: score+=15; reasons.append(f"RSI unter Druck ({rsi:.1f})")
            if macd.get("hist",0) < 0: score+=15; reasons.append("MACD Histogram negativ")
            if volr >= 1.15: score+=10; reasons.append(f"Volumen bestätigt ({volr:.1f}x)")
            if funding < -0.06: score-=8; warnings.append(f"Funding stark negativ ({funding:+.4f}%)")
        else:
            return self.neutral(ctx, ["Kein sauberer EMA-Trendfilter"])
        score=max(0,min(100,score)); status="confirmed" if score>=65 else "watch" if score>=45 else "neutral"
        if status == "neutral": return self.neutral(ctx, reasons, warnings)
        if side == "long":
            sl = price - atr*1.4; tps=[price + (price-sl)*1.5, price + (price-sl)*2.5]; rr=(tps[-1]-price)/(price-sl)
        else:
            sl = price + atr*1.4; tps=[price - (sl-price)*1.5, price - (sl-price)*2.5]; rr=(price-tps[-1])/(sl-price)
        return SignalResult(self.id,self.name,ctx.symbol,ctx.exchange,ctx.timeframe,side,round(score,1),status,round(price,6),round(sl,6),[round(x,6) for x in tps],round(rr,2),reasons,warnings,ctx.candle_time).finalize()
