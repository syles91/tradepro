#!/usr/bin/env python3
"""
TradePro Backend v3 — Multi-Exchange Crypto Terminal
Modular entrypoint.
"""

from tradepro_backend.app_factory import create_app
from tradepro_backend.routes_market import api_volume_profile
from tradepro_backend.state import hub

app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server_v2:app", host="0.0.0.0", port=7777, reload=False)
