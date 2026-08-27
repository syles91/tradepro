from fastapi import APIRouter
from fastapi.responses import JSONResponse
from tradepro.core import database as db
from tradepro.signals.engine import SignalEngine
from tradepro.signals.outcomes import refresh_open_signals
from tradepro.analytics.backtester import run_backtest

router = APIRouter(prefix="/api", tags=["signals"])
_engine = None

def setup(hub=None):
    global _engine
    _engine = SignalEngine(hub=hub)
    return router

@router.get("/strategies")
async def strategies():
    return JSONResponse({"strategies": db.strategy_rows()})

@router.post("/strategies/{strategy_id}/enable")
async def enable_strategy(strategy_id: str):
    db.set_strategy_enabled(strategy_id, True)
    return JSONResponse({"ok": True, "strategy_id": strategy_id, "enabled": True})

@router.post("/strategies/{strategy_id}/disable")
async def disable_strategy(strategy_id: str):
    db.set_strategy_enabled(strategy_id, False)
    return JSONResponse({"ok": True, "strategy_id": strategy_id, "enabled": False})

@router.get("/signals/current")
async def current_signals(symbol: str="BTCUSDT", tf: str="5m", exchange: str="binance", persist: bool=True):
    return JSONResponse(await _engine.evaluate(symbol, tf, exchange, persist=persist))

@router.get("/signals/history")
async def signal_history(limit: int=100, strategy_id: str|None=None, symbol: str|None=None):
    return JSONResponse({"signals": db.signal_history(limit=min(limit,500), strategy_id=strategy_id, symbol=symbol)})

@router.get("/signals/open")
async def open_signals(refresh: bool=True, limit: int=100):
    rows = await refresh_open_signals(limit=min(limit, 300)) if refresh else db.open_signal_rows(limit=min(limit, 300))
    return JSONResponse({"signals": rows})

@router.get("/backtest/runs")
async def backtest_run_list(limit: int=20):
    return JSONResponse({"runs": db.backtest_runs(limit=min(limit, 100))})

@router.post("/backtest/run")
async def backtest_run(strategy_id: str="trend_pullback", symbol: str="BTCUSDT", tf: str="5m", exchange: str="binance", limit: int=1000, horizon: int=96, min_status: str="watch"):
    try:
        return JSONResponse(await run_backtest(strategy_id, symbol, tf, exchange, limit, horizon, min_status, persist=True))
    except Exception as e:
        return JSONResponse({"error": str(e)[:300]}, status_code=400)

@router.get("/analytics/overview")
async def analytics_overview():
    return JSONResponse(db.analytics_overview())
