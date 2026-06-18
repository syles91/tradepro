#!/usr/bin/env python3
"""
Crypto Trading Dashboard — FastAPI Backend
- Live Marktdaten via Binance API
- Cron-Job Trigger (Analyse + Sentiment)
- WebSocket für Live-Updates
- Chart-Auslieferung
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Set

import requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ── Pfade ─────────────────────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent
STATIC_DIR   = BASE_DIR / "static"
CHARTS_DIR   = STATIC_DIR / "charts"
VENV_PYTHON  = "/opt/hermes/.venv/bin/python3"
SCRIPTS_DIR  = "/home/hermes/.hermes/scripts"

CHART_BTC    = Path("/tmp/btc_chart.png")
CHART_LIQ    = Path("/tmp/coinglass_liquidations.png")

STATIC_DIR.mkdir(exist_ok=True)
CHARTS_DIR.mkdir(exist_ok=True)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Crypto Dashboard")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ── WebSocket Manager ─────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws: WebSocket):
        self.active.discard(ws)

    async def broadcast(self, data: dict):
        dead = set()
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        self.active -= dead

manager = ConnectionManager()

# ── Job State ─────────────────────────────────────────────────────────────────
job_state = {
    "analyse":   {"running": False, "last_run": None, "last_status": None, "log": []},
    "sentiment": {"running": False, "last_run": None, "last_status": None, "log": []},
}

# ── Binance Fetchers ──────────────────────────────────────────────────────────
FAPI  = "https://fapi.binance.com/fapi/v1"
FDATA = "https://fapi.binance.com/futures/data"
BASE  = "https://api.binance.com/api/v3"
PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]

def _get(url, params=None):
    r = requests.get(url, params=params, timeout=8)
    r.raise_for_status()
    return r.json()

def fetch_ticker(symbol):
    return _get(f"{BASE}/ticker/24hr", {"symbol": symbol})

def fetch_futures(symbol):
    prem = _get(f"{FAPI}/premiumIndex", {"symbol": symbol})
    oi   = _get(f"{FAPI}/openInterest", {"symbol": symbol})
    return {
        "funding": float(prem.get("lastFundingRate", 0)) * 100,
        "mark":    float(prem.get("markPrice", 0)),
        "oi":      float(oi.get("openInterest", 0)),
    }

def fetch_ls_ratio(symbol):
    try:
        d = _get(f"{FDATA}/globalLongShortAccountRatio",
                 {"symbol": symbol, "period": "1h", "limit": 1})
        return float(d[0]["longAccount"]) * 100 if d else None
    except:
        return None

def fetch_fear_greed():
    try:
        d = requests.get("https://api.alternative.me/fng/?limit=1", timeout=6).json()
        v = int(d["data"][0]["value"])
        l = d["data"][0]["value_classification"]
        return {"value": v, "label": l}
    except:
        return {"value": 0, "label": "N/A"}

def fetch_btc_dominance():
    try:
        d = requests.get("https://api.coingecko.com/api/v3/global", timeout=6).json()
        return round(d["data"]["market_cap_percentage"]["btc"], 1)
    except:
        return None

def fetch_oi_history(symbol="BTCUSDT", limit=24):
    try:
        data = _get(f"{FDATA}/openInterestHist",
                    {"symbol": symbol, "period": "1h", "limit": limit})
        return [{"t": d["timestamp"], "v": float(d["sumOpenInterestValue"]) / 1e9} for d in data]
    except:
        return []

def fetch_funding_history(symbol="BTCUSDT", limit=12):
    try:
        data = _get(f"{FAPI}/fundingRate", {"symbol": symbol, "limit": limit})
        return [{"t": d["fundingTime"], "v": float(d["fundingRate"]) * 100} for d in data]
    except:
        return []

def fetch_ls_history(symbol="BTCUSDT", limit=24):
    try:
        data = _get(f"{FDATA}/globalLongShortAccountRatio",
                    {"symbol": symbol, "period": "1h", "limit": limit})
        return [{"t": d["timestamp"], "l": float(d["longAccount"]) * 100} for d in data]
    except:
        return []

def build_market_data():
    """Sammelt alle Marktdaten für Dashboard"""
    coins = []
    for sym in PAIRS:
        try:
            t   = fetch_ticker(sym)
            fut = fetch_futures(sym)
            ls  = fetch_ls_ratio(sym)
            price    = float(t["lastPrice"])
            change   = float(t["priceChangePercent"])
            vol24h   = float(t["quoteVolume"]) / 1e9
            oi_usd   = fut["oi"] * price / 1e9
            coins.append({
                "symbol":   sym.replace("USDT", ""),
                "price":    price,
                "change":   change,
                "vol24h":   round(vol24h, 2),
                "funding":  round(fut["funding"], 4),
                "oi":       round(oi_usd, 2),
                "longs":    round(ls, 1) if ls else None,
            })
        except Exception as e:
            coins.append({"symbol": sym.replace("USDT", ""), "error": str(e)})

    fg  = fetch_fear_greed()
    dom = fetch_btc_dominance()
    oi_hist = fetch_oi_history()
    fr_hist = fetch_funding_history()
    ls_hist = fetch_ls_history()

    return {
        "coins":      coins,
        "fear_greed": fg,
        "btc_dom":    dom,
        "oi_hist":    oi_hist,
        "fr_hist":    fr_hist,
        "ls_hist":    ls_hist,
        "updated":    datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC"),
    }

# ── Script Runner ─────────────────────────────────────────────────────────────
async def run_script(job_name: str, script: str):
    """Führt ein Script aus, streamt Log via WebSocket"""
    if job_state[job_name]["running"]:
        return False

    job_state[job_name]["running"] = True
    job_state[job_name]["log"] = []
    await manager.broadcast({"type": "job_start", "job": job_name})

    env = os.environ.copy()
    env["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/hermes/.playwright"

    try:
        proc = await asyncio.create_subprocess_exec(
            VENV_PYTHON, f"{SCRIPTS_DIR}/{script}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        ok = proc.returncode == 0

        # Charts in static kopieren
        for src, name in [(CHART_BTC, "btc_chart.png"), (CHART_LIQ, "liq_chart.png")]:
            if src.exists():
                shutil.copy(src, CHARTS_DIR / name)

        log_lines = []
        if stderr:
            for line in stderr.decode(errors="replace").splitlines():
                if line.strip():
                    log_lines.append(line)

        job_state[job_name]["running"]     = False
        job_state[job_name]["last_run"]    = datetime.now(timezone.utc).isoformat()
        job_state[job_name]["last_status"] = "ok" if ok else "error"
        job_state[job_name]["log"]         = log_lines[-20:]

        await manager.broadcast({
            "type":   "job_done",
            "job":    job_name,
            "status": "ok" if ok else "error",
            "log":    log_lines[-20:],
        })
        return ok

    except asyncio.TimeoutError:
        job_state[job_name]["running"]     = False
        job_state[job_name]["last_status"] = "timeout"
        await manager.broadcast({"type": "job_done", "job": job_name, "status": "timeout", "log": []})
        return False
    except Exception as e:
        job_state[job_name]["running"]     = False
        job_state[job_name]["last_status"] = "error"
        await manager.broadcast({"type": "job_done", "job": job_name, "status": "error", "log": [str(e)]})
        return False

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    html_path = BASE_DIR / "static" / "index.html"
    return HTMLResponse(html_path.read_text())

@app.get("/api/market")
async def api_market():
    try:
        return JSONResponse(build_market_data())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/api/status")
async def api_status():
    return JSONResponse({
        "jobs":    job_state,
        "charts": {
            "btc": (CHARTS_DIR / "btc_chart.png").exists(),
            "liq": (CHARTS_DIR / "liq_chart.png").exists(),
        },
        "updated": datetime.now(timezone.utc).isoformat(),
    })

@app.post("/api/run/analyse")
async def trigger_analyse():
    asyncio.create_task(run_script("analyse", "crypto_analysis.py"))
    return JSONResponse({"status": "started"})

@app.post("/api/run/sentiment")
async def trigger_sentiment():
    asyncio.create_task(run_script("sentiment", "coinglass_screenshot.py"))
    return JSONResponse({"status": "started"})

@app.post("/api/run/full")
async def trigger_full():
    async def run_both():
        await run_script("analyse", "crypto_analysis.py")
        await run_script("sentiment", "coinglass_screenshot.py")
    asyncio.create_task(run_both())
    return JSONResponse({"status": "started"})

@app.get("/charts/{name}")
async def get_chart(name: str):
    path = CHARTS_DIR / name
    if path.exists():
        return FileResponse(str(path))
    return JSONResponse({"error": "not found"}, status_code=404)

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            # Ping alle 30s um Verbindung lebendig zu halten
            await asyncio.sleep(30)
            try:
                await ws.send_json({"type": "ping"})
            except:
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)

# ── Background Task: Markt-Broadcast alle 60s ─────────────────────────────────
@app.on_event("startup")
async def startup():
    asyncio.create_task(market_broadcaster())

async def market_broadcaster():
    while True:
        await asyncio.sleep(60)
        if manager.active:
            try:
                data = build_market_data()
                await manager.broadcast({"type": "market_update", "data": data})
            except:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=7777, reload=False)
