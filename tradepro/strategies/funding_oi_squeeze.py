from .base import StrategyBase
from tradepro.core.models import SignalResult

class FundingOiSqueeze(StrategyBase):
    id = "funding_oi_squeeze"
    name = "Funding/OI Squeeze"
    description = "Derivate-Crowding: Funding-Extreme + OI-Aufbau + Momentum-Reversal."
    default_config = {"funding_extreme": 0.05, "min_confirmed": 65, "min_watch": 45}

    async def evaluate(self, ctx):
        price=ctx.price; ind=ctx.indicators; atr=ind.get("atr",0) or price*0.01
        funding=ctx.ticker.get("funding",0) or 0; rsi=ind.get("rsi",50); macd=ind.get("macd",{}); score=0; reasons=[]; warnings=[]; side="neutral"
        oi_change=0
        try:
            first=float(ctx.oi_hist[0]["sumOpenInterestValue"]); last=float(ctx.oi_hist[-1]["sumOpenInterestValue"]); oi_change=(last-first)/first*100 if first else 0
        except Exception: pass
        if funding > 0.05:
            side="short"; score+=25; reasons.append(f"Long-Crowding: Funding {funding:+.4f}%")
            if oi_change>3: score+=20; reasons.append(f"OI steigt +{oi_change:.1f}% (mehr Leverage)")
            if rsi>62: score+=15; reasons.append(f"RSI überhitzt ({rsi:.1f})")
            if macd.get("hist",0)<0: score+=15; reasons.append("Momentum dreht gegen Long-Crowd")
        elif funding < -0.05:
            side="long"; score+=25; reasons.append(f"Short-Crowding: Funding {funding:+.4f}%")
            if oi_change>3: score+=20; reasons.append(f"OI steigt +{oi_change:.1f}% (mehr Leverage)")
            if rsi<38: score+=15; reasons.append(f"RSI überverkauft ({rsi:.1f})")
            if macd.get("hist",0)>0: score+=15; reasons.append("Momentum dreht gegen Short-Crowd")
        else:
            return self.neutral(ctx, [f"Funding nicht extrem ({funding:+.4f}%)"])
        if oi_change < -2: warnings.append(f"OI fällt {oi_change:.1f}% — Squeeze weniger wahrscheinlich")
        liq_long=sum(float(x.get("usd",0)) for x in ctx.liquidations if x.get("side")=="SELL")
        liq_short=sum(float(x.get("usd",0)) for x in ctx.liquidations if x.get("side")=="BUY")
        if side=="long" and liq_short>liq_long and liq_short>100000: score+=10; reasons.append("Short-Liquidationen bestätigen Squeeze")
        if side=="short" and liq_long>liq_short and liq_long>100000: score+=10; reasons.append("Long-Liquidationen bestätigen Risiko")
        score=max(0,min(100,score)); status="confirmed" if score>=65 else "watch" if score>=45 else "neutral"
        if status=="neutral": return self.neutral(ctx, reasons, warnings)
        if side=="long": sl=price-atr*1.6; tps=[price+(price-sl)*1.4, price+(price-sl)*2.2]; rr=(tps[-1]-price)/(price-sl)
        else: sl=price+atr*1.6; tps=[price-(sl-price)*1.4, price-(sl-price)*2.2]; rr=(price-tps[-1])/(sl-price)
        return SignalResult(self.id,self.name,ctx.symbol,ctx.exchange,ctx.timeframe,side,round(score,1),status,round(price,6),round(sl,6),[round(x,6) for x in tps],round(rr,2),reasons,warnings,ctx.candle_time).finalize()
