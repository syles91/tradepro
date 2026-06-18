from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from .config import STATIC_DIR
from .routes_ai import router as ai_router
from .routes_market import router as market_router
from .routes_pages import router as pages_router
from .state import hub


def create_app() -> FastAPI:
    app = FastAPI(title="TradePro")

    app.include_router(market_router)
    app.include_router(ai_router)
    app.include_router(pages_router)
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        try:
            while True:
                msg = await ws.receive_json()
                action = msg.get("action")
                if action == "subscribe":
                    ex = msg.get("exchange", "binance")
                    symbol = msg.get("symbol", "BTCUSDT").upper()
                    tf = msg.get("tf", "5m")
                    hub.unsubscribe(ws)
                    await hub.subscribe(ws, ex, symbol, tf)
                    mk = f"{ex}:{symbol}"
                    if mk in hub.last_mark:
                        await ws.send_json({"type": "mark", "exchange": ex, "symbol": symbol, **hub.last_mark[mk]})
                    await ws.send_json({"type": "subscribed", "exchange": ex, "symbol": symbol, "tf": tf})
                elif action == "ping":
                    await ws.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            hub.unsubscribe(ws)

    return app
