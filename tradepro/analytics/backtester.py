import hashlib
import time
import httpx
from tradepro.core.models import MarketContext
from tradepro.core import database as db
from tradepro.indicators import ema, rsi, macd, atr, volume_ratio
from tradepro.market.service import load_candles
from tradepro.strategies import DEFAULT_STRATEGIES
from tradepro.signals.outcomes import _evaluate_path


def _strategy(strategy_id):
    for s in DEFAULT_STRATEGIES:
        if s.id == strategy_id:
            return s
    raise ValueError(f"unknown strategy: {strategy_id}")


def _ctx(symbol, exchange, tf, candles):
    closes=[c.close for c in candles]
    indicators={"rsi": rsi(closes), "macd": macd(closes), "atr": atr(candles), "vol_ratio": volume_ratio(candles)}
    for p in (20,50,200): indicators[f"ema{p}"] = ema(closes, p)[-1] if closes else 0
    return MarketContext(symbol=symbol, exchange=exchange, timeframe=tf, candles=candles, ticker={"funding":0}, indicators=indicators)


async def run_backtest(strategy_id="trend_pullback", symbol="BTCUSDT", tf="5m", exchange="binance", limit=1000, horizon=96, min_status="watch", persist=True):
    strat=_strategy(strategy_id); symbol=symbol.upper(); limit=max(260, min(int(limit), 1500)); horizon=max(12, min(int(horizon), 240))
    async with httpx.AsyncClient() as client:
        candles = await load_candles(client, symbol, tf, exchange, limit)
    trades=[]; i=220
    status_rank={"neutral":0,"watch":1,"confirmed":2}
    min_rank=status_rank.get(min_status, 1)
    while i < len(candles)-horizon-1:
        ctx=_ctx(symbol, exchange, tf, candles[:i+1])
        sig=await strat.evaluate(ctx)
        if status_rank.get(sig.status, 0) >= min_rank and sig.entry and sig.stop_loss:
            d=sig.to_dict()
            path=candles[i+1:i+1+horizon]
            outcome=_evaluate_path(d, path, max_age_bars=horizon)
            if outcome:
                out, exit_price, exit_time, r_mult, mfe, mae = outcome
                trades.append({"time":d["candle_time"],"side":d["side"],"entry":d["entry"],"stop_loss":d["stop_loss"],"take_profit":d["take_profit"],"confidence":d["confidence"],"outcome":out,"exit_price":exit_price,"exit_time":exit_time,"r_multiple":round(r_mult,2),"mfe":round(mfe,2),"mae":round(mae,2)})
                # avoid duplicate signal spam in same setup window
                try: exit_idx=next(j for j,c in enumerate(candles) if c.time == exit_time); i=max(i+1, exit_idx)
                except StopIteration: i += horizon
                continue
        i += 1
    wins=sum(1 for t in trades if t["r_multiple"]>0); losses=sum(1 for t in trades if t["r_multiple"]<0)
    gross_win=sum(t["r_multiple"] for t in trades if t["r_multiple"]>0); gross_loss=abs(sum(t["r_multiple"] for t in trades if t["r_multiple"]<0))
    equity=[]; acc=0; peak=0; maxdd=0
    for t in trades:
        acc += t["r_multiple"]; peak=max(peak, acc); maxdd=min(maxdd, acc-peak); equity.append(round(acc,2))
    result={"strategy_id":strategy_id,"strategy_name":strat.name,"symbol":symbol,"exchange":exchange,"timeframe":tf,"candles":len(candles),"trades":len(trades),"wins":wins,"losses":losses,"winrate":round(wins/len(trades)*100,1) if trades else 0,"net_r":round(acc,2),"avg_r":round(acc/len(trades),2) if trades else 0,"profit_factor":round(gross_win/gross_loss,2) if gross_loss else (round(gross_win,2) if gross_win else 0),"max_drawdown_r":round(maxdd,2),"horizon_bars":horizon,"min_status":min_status,"equity":equity[-200:],"trades_sample":trades[-80:]}
    run={"id":hashlib.sha1(f"{strategy_id}:{symbol}:{exchange}:{tf}:{time.time()}".encode()).hexdigest()[:16],"strategy_id":strategy_id,"symbol":symbol,"exchange":exchange,"timeframe":tf,"config":{"limit":limit,"horizon":horizon,"min_status":min_status},"result":result,"created_at":int(time.time())}
    if persist: db.save_backtest_run(run)
    return run
