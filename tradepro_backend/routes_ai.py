import json

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

import ai_assistant as ai
from .state import hub

router = APIRouter(prefix="/api/ai")


@router.get("/health")
async def ai_health():
    return JSONResponse({"ok": bool(ai.load_anthropic_key()), "model": ai.ANTHROPIC_MODEL})


@router.get("/analyze")
async def ai_analyze(symbol: str = "BTCUSDT", tf: str = "5m", exchange: str = "binance", question: str = ""):
    async def gen():
        try:
            snap = await ai.gather_snapshot(symbol, tf, exchange)
            liq_sum = ai.liquidation_summary(hub, exchange, symbol)
            yield f"event: snapshot\ndata: {json.dumps(snap)}\n\n"
            async for chunk in ai.stream_analysis(snap, liq_sum, question or None):
                safe = chunk.replace("\r", "")
                payload = json.dumps({"t": safe})
                yield f"event: chunk\ndata: {payload}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'msg': str(e)[:200]})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
