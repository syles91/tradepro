from .base import StrategyBase
from tradepro.core.models import SignalResult

class BreakoutVolume(StrategyBase):
    id = "breakout_volume"
    name = "Breakout Volume"
    description = "Range-Breakout über/unter 20-Kerzen-Level mit Volumen- und Momentum-Bestätigung."
    default_config = {"lookback": 20, "min_confirmed": 68, "min_watch": 50, "atr_stop": 1.2}

    async def evaluate(self, ctx):
        if len(ctx.candles) < 30: return self.neutral(ctx, ["Zu wenig Kerzen"])
        price=ctx.price; prev=ctx.candles[-21:-1]
        high=max(c.high for c in prev); low=min(c.low for c in prev)
        ind=ctx.indicators; atr=ind.get("atr",0) or price*0.008; volr=ind.get("vol_ratio",1); rsi=ind.get("rsi",50); macd=ind.get("macd",{})
        score=0; reasons=[]; warnings=[]; side="neutral"
        if price > high:
            side="long"; score+=35; reasons.append(f"Close über 20-Kerzen-Hoch ({high:.4f})")
            if volr>=1.4: score+=20; reasons.append(f"Breakout-Volumen {volr:.1f}x")
            else: warnings.append(f"Volumen noch schwach ({volr:.1f}x)")
            if rsi>55: score+=15; reasons.append(f"RSI Momentum bullish ({rsi:.1f})")
            if macd.get("hist",0)>0: score+=15; reasons.append("MACD bestätigt bullish")
        elif price < low:
            side="short"; score+=35; reasons.append(f"Close unter 20-Kerzen-Tief ({low:.4f})")
            if volr>=1.4: score+=20; reasons.append(f"Breakdown-Volumen {volr:.1f}x")
            else: warnings.append(f"Volumen noch schwach ({volr:.1f}x)")
            if rsi<45: score+=15; reasons.append(f"RSI Momentum bearish ({rsi:.1f})")
            if macd.get("hist",0)<0: score+=15; reasons.append("MACD bestätigt bearish")
        else:
            return self.neutral(ctx, ["Kein Range-Breakout"])
        score=max(0,min(100,score)); status="confirmed" if score>=68 else "watch" if score>=50 else "neutral"
        if status=="neutral": return self.neutral(ctx, reasons, warnings)
        if side=="long": sl=min(high-atr*0.4, price-atr*1.2); tps=[price+(price-sl)*1.5, price+(price-sl)*2.4]; rr=(tps[-1]-price)/(price-sl)
        else: sl=max(low+atr*0.4, price+atr*1.2); tps=[price-(sl-price)*1.5, price-(sl-price)*2.4]; rr=(price-tps[-1])/(sl-price)
        return SignalResult(self.id,self.name,ctx.symbol,ctx.exchange,ctx.timeframe,side,round(score,1),status,round(price,6),round(sl,6),[round(x,6) for x in tps],round(rr,2),reasons,warnings,ctx.candle_time).finalize()
