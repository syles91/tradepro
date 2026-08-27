from tradepro.core import database as db
from tradepro.market.service import load_candles
import httpx


def _r_multiple(sig, exit_price):
    entry = float(sig["entry"]); sl = float(sig["stop_loss"])
    risk = abs(entry - sl) or 1e-9
    return (exit_price - entry) / risk if sig["side"] == "long" else (entry - exit_price) / risk


def _evaluate_path(sig, candles, max_age_bars=96):
    entry=float(sig["entry"]); sl=float(sig["stop_loss"]); tps=[float(x) for x in sig.get("take_profit", [])]
    relevant=[c for c in candles if sig.get("candle_time") is None or c.time > sig["candle_time"]]
    if not relevant: return None
    mfe = mae = 0.0
    for idx,c in enumerate(relevant[:max_age_bars], start=1):
        if sig["side"] == "long":
            mfe=max(mfe, _r_multiple(sig, c.high)); mae=min(mae, _r_multiple(sig, c.low))
            sl_hit = c.low <= sl
            tp2_hit = len(tps) > 1 and c.high >= tps[1]
            tp1_hit = len(tps) > 0 and c.high >= tps[0]
            if sl_hit and (tp1_hit or tp2_hit): return ("SL_HIT", sl, c.time, -1.0, mfe, mae)  # conservative when same candle hits both
            if tp2_hit: return ("TP2_HIT", tps[1], c.time, _r_multiple(sig, tps[1]), mfe, mae)
            if sl_hit: return ("SL_HIT", sl, c.time, -1.0, mfe, mae)
            if tp1_hit and idx >= max_age_bars: return ("TP1_HIT", tps[0], c.time, _r_multiple(sig, tps[0]), mfe, mae)
        else:
            mfe=max(mfe, _r_multiple(sig, c.low)); mae=min(mae, _r_multiple(sig, c.high))
            sl_hit = c.high >= sl
            tp2_hit = len(tps) > 1 and c.low <= tps[1]
            tp1_hit = len(tps) > 0 and c.low <= tps[0]
            if sl_hit and (tp1_hit or tp2_hit): return ("SL_HIT", sl, c.time, -1.0, mfe, mae)
            if tp2_hit: return ("TP2_HIT", tps[1], c.time, _r_multiple(sig, tps[1]), mfe, mae)
            if sl_hit: return ("SL_HIT", sl, c.time, -1.0, mfe, mae)
            if tp1_hit and idx >= max_age_bars: return ("TP1_HIT", tps[0], c.time, _r_multiple(sig, tps[0]), mfe, mae)
    if len(relevant) >= max_age_bars:
        last = relevant[max_age_bars-1]
        return ("EXPIRED", last.close, last.time, _r_multiple(sig, last.close), mfe, mae)
    return None


async def refresh_open_signals(limit=100):
    rows = db.open_signal_rows(limit)
    grouped = {}
    for s in rows:
        grouped.setdefault((s["symbol"], s["timeframe"], s["exchange"]), []).append(s)
    async with httpx.AsyncClient() as client:
        for (symbol, tf, exchange), sigs in grouped.items():
            try:
                candles = await load_candles(client, symbol, tf, exchange, 500)
            except Exception:
                continue
            for sig in sigs:
                outcome = _evaluate_path(sig, candles)
                if outcome:
                    db.update_outcome(sig["id"], *outcome)
    return db.open_signal_rows(limit)
