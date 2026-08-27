def ema(values, period):
    if not values: return []
    k = 2 / (period + 1)
    out = [float(values[0])]
    for v in values[1:]: out.append(float(v) * k + out[-1] * (1 - k))
    return out

def rsi(values, period=14):
    if len(values) <= period: return 50.0
    gains=[]; losses=[]
    for a,b in zip(values[-period-1:-1], values[-period:]):
        ch=b-a; gains.append(max(ch,0)); losses.append(max(-ch,0))
    ag=sum(gains)/period; al=sum(losses)/period
    if al == 0: return 100.0
    rs=ag/al
    return 100 - 100/(1+rs)

def macd(values, fast=12, slow=26, signal=9):
    if len(values) < slow + signal: return {"macd":0,"signal":0,"hist":0,"bias":"neutral"}
    ef=ema(values, fast); es=ema(values, slow)
    line=[a-b for a,b in zip(ef[-len(es):], es)]
    sig=ema(line, signal)
    hist=line[-1]-sig[-1]
    return {"macd":line[-1], "signal":sig[-1], "hist":hist, "bias":"bullish" if hist>0 else "bearish" if hist<0 else "neutral"}

def atr(candles, period=14):
    if len(candles) <= period: return 0.0
    trs=[]
    for prev,c in zip(candles[-period-1:-1], candles[-period:]):
        trs.append(max(c.high-c.low, abs(c.high-prev.close), abs(c.low-prev.close)))
    return sum(trs)/len(trs)

def volume_ratio(candles, period=20):
    if len(candles) <= period: return 1.0
    avg=sum(c.volume for c in candles[-period-1:-1])/period
    return candles[-1].volume/avg if avg else 1.0
