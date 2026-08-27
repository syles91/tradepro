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


def _with_executable_entry(signal, next_open, slippage_bps):
    """Backtests should enter on the next candle open, not the signal candle close."""
    d=dict(signal)
    old_entry=float(d["entry"]); old_sl=float(d["stop_loss"])
    slip = float(slippage_bps) / 10000.0
    new_entry = next_open * (1 + slip if d["side"] == "long" else 1 - slip)
    risk = abs(old_entry - old_sl) or old_entry*0.01
    if d["side"] == "long":
        d["entry"] = new_entry
        d["stop_loss"] = new_entry - risk
        d["take_profit"] = [new_entry + risk*1.5, new_entry + risk*2.5]
    else:
        d["entry"] = new_entry
        d["stop_loss"] = new_entry + risk
        d["take_profit"] = [new_entry - risk*1.5, new_entry - risk*2.5]
    return d


async def run_backtest(strategy_id: str="trend_pullback", symbol: str="BTCUSDT", tf: str="5m", exchange: str="binance", limit: int=1000, horizon: int=96, min_status: str="watch", persist: bool=True, min_confidence: float=0, fee_bps: float=4, slippage_bps: float=2):
    strat=_strategy(strategy_id); symbol=symbol.upper(); limit=max(260, min(int(limit), 1500)); horizon=max(12, min(int(horizon), 240))
    min_confidence=max(0, min(100, float(min_confidence))); fee_r = (float(fee_bps) * 2) / 10000.0
    async with httpx.AsyncClient() as client:
        candles = await load_candles(client, symbol, tf, exchange, limit)
    trades=[]; i=220
    status_rank={"neutral":0,"watch":1,"confirmed":2}
    min_rank=status_rank.get(min_status, 1)
    while i < len(candles)-horizon-2:
        ctx=_ctx(symbol, exchange, tf, candles[:i+1])
        sig=await strat.evaluate(ctx)
        if status_rank.get(sig.status, 0) >= min_rank and sig.entry and sig.stop_loss and float(sig.confidence) >= min_confidence:
            d=_with_executable_entry(sig.to_dict(), candles[i+1].open, slippage_bps)
            path=candles[i+1:i+1+horizon]
            outcome=_evaluate_path(d, path, max_age_bars=horizon)
            if outcome:
                out, exit_price, exit_time, r_mult, mfe, mae = outcome
                risk_cash = abs(float(d["entry"])-float(d["stop_loss"])) or 1e-9
                fee_as_r = (float(d["entry"]) * fee_r) / risk_cash
                net_r = r_mult - fee_as_r
                trades.append({"time":d["candle_time"],"side":d["side"],"entry":round(d["entry"],6),"stop_loss":round(d["stop_loss"],6),"take_profit":[round(x,6) for x in d["take_profit"]],"confidence":d["confidence"],"outcome":out,"exit_price":exit_price,"exit_time":exit_time,"r_multiple":round(net_r,2),"gross_r":round(r_mult,2),"fees_r":round(fee_as_r,3),"mfe":round(mfe,2),"mae":round(mae,2)})
                try: exit_idx=next(j for j,c in enumerate(candles) if c.time == exit_time); i=max(i+1, exit_idx)
                except StopIteration: i += horizon
                continue
        i += 1
    wins=sum(1 for t in trades if t["r_multiple"]>0); losses=sum(1 for t in trades if t["r_multiple"]<0)
    gross_win=sum(t["r_multiple"] for t in trades if t["r_multiple"]>0); gross_loss=abs(sum(t["r_multiple"] for t in trades if t["r_multiple"]<0))
    equity=[]; acc=0; peak=0; maxdd=0
    for t in trades:
        acc += t["r_multiple"]; peak=max(peak, acc); maxdd=min(maxdd, acc-peak); equity.append(round(acc,2))
    result={"strategy_id":strategy_id,"strategy_name":strat.name,"symbol":symbol,"exchange":exchange,"timeframe":tf,"candles":len(candles),"trades":len(trades),"wins":wins,"losses":losses,"winrate":round(wins/len(trades)*100,1) if trades else 0,"net_r":round(acc,2),"avg_r":round(acc/len(trades),2) if trades else 0,"profit_factor":round(gross_win/gross_loss,2) if gross_loss else (round(gross_win,2) if gross_win else 0),"max_drawdown_r":round(maxdd,2),"horizon_bars":horizon,"min_status":min_status,"min_confidence":min_confidence,"fee_bps":fee_bps,"slippage_bps":slippage_bps,"model":"next_open_entry_fee_slippage","equity":equity[-200:],"trades_sample":trades[-80:]}
    run={"id":hashlib.sha1(f"{strategy_id}:{symbol}:{exchange}:{tf}:{time.time()}".encode()).hexdigest()[:16],"strategy_id":strategy_id,"symbol":symbol,"exchange":exchange,"timeframe":tf,"config":{"limit":limit,"horizon":horizon,"min_status":min_status,"min_confidence":min_confidence,"fee_bps":fee_bps,"slippage_bps":slippage_bps},"result":result,"created_at":int(time.time())}
    if persist: db.save_backtest_run(run)
    return run
