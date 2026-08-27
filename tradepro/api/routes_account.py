from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from tradepro import paper

router = APIRouter(prefix="/api", tags=["account"])

class SettingsPayload(BaseModel):
    signal_timeframes: list[str] | None = None
    auto_paper: bool | None = None
    min_signal_confidence: float | None = None
    demo_balance: float | None = None
    risk_per_trade: float | None = None
    max_leverage: float | None = None

class OpenPaperPayload(BaseModel):
    signal: dict
    price: float | None = None

class ClosePaperPayload(BaseModel):
    price: float

def user(request: Request) -> str:
    u=getattr(request.state, 'user', None) or {'username':'demo'}
    return u.get('username','demo')

@router.get('/settings')
async def get_settings(request: Request):
    return JSONResponse(paper.settings(user(request)))

@router.post('/settings')
async def save_settings(payload: SettingsPayload, request: Request):
    username=user(request)
    allowed_tfs={'1m','3m','5m','15m','1h','4h','1d'}
    if payload.signal_timeframes is not None:
        tfs=[x for x in payload.signal_timeframes if x in allowed_tfs]
        paper.set_setting(username,'signal_timeframes', tfs or ['5m','15m','1h'])
    if payload.auto_paper is not None:
        paper.set_setting(username,'auto_paper', bool(payload.auto_paper))
    if payload.min_signal_confidence is not None:
        paper.set_setting(username,'min_signal_confidence', max(0, min(100, float(payload.min_signal_confidence))))
    if payload.demo_balance is not None or payload.risk_per_trade is not None or payload.max_leverage is not None:
        paper.update_account(username, payload.demo_balance, payload.risk_per_trade, payload.max_leverage)
    return JSONResponse(paper.settings(username))

@router.get('/paper/account')
async def paper_account(request: Request):
    return JSONResponse(paper.account_summary(user(request)))

@router.post('/paper/reset')
async def paper_reset(request: Request, balance: float=10000):
    username=user(request)
    paper.update_account(username, balance=balance)
    # Keep trade history for audit, close open positions as RESET at current entry to avoid hidden risk.
    for p in paper.list_positions(username,'OPEN'):
        try: paper.close_position(username, p['id'], p['entry'])
        except Exception: pass
    return JSONResponse(paper.account_summary(username))

@router.post('/paper/open')
async def paper_open(payload: OpenPaperPayload, request: Request):
    try:
        return JSONResponse({'position': paper.open_position(user(request), payload.signal, payload.price)})
    except Exception as e:
        return JSONResponse({'error': str(e)[:240]}, status_code=400)

@router.post('/paper/positions/{position_id}/close')
async def paper_close(position_id: str, payload: ClosePaperPayload, request: Request):
    try:
        return JSONResponse(paper.close_position(user(request), position_id, payload.price))
    except Exception as e:
        return JSONResponse({'error': str(e)[:240]}, status_code=400)
