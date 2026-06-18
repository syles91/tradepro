from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from .config import STATIC_DIR

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse(
        (STATIC_DIR / "app.html").read_text(),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
    )


@router.get("/classic", response_class=HTMLResponse)
async def classic():
    return HTMLResponse((STATIC_DIR / "classic.html").read_text())


@router.get("/guide", response_class=HTMLResponse)
async def guide():
    return HTMLResponse((STATIC_DIR / "guide.html").read_text())
