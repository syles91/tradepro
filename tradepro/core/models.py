from dataclasses import dataclass, field, asdict
from typing import Literal
import hashlib
import time

Side = Literal["long", "short", "neutral"]
Status = Literal["watch", "confirmed", "invalidated", "neutral"]

@dataclass
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

@dataclass
class MarketContext:
    symbol: str
    exchange: str
    timeframe: str
    candles: list[Candle]
    ticker: dict = field(default_factory=dict)
    oi_hist: list[dict] = field(default_factory=list)
    funding_hist: list[dict] = field(default_factory=list)
    ls_hist: dict = field(default_factory=dict)
    cvd: list[dict] = field(default_factory=list)
    volume_profile: dict = field(default_factory=dict)
    orderbook: dict = field(default_factory=dict)
    liquidations: list[dict] = field(default_factory=list)
    indicators: dict = field(default_factory=dict)

    @property
    def price(self) -> float:
        return self.candles[-1].close if self.candles else float(self.ticker.get("price", 0) or 0)

    @property
    def candle_time(self) -> int | None:
        return self.candles[-1].time if self.candles else None

@dataclass
class SignalResult:
    strategy_id: str
    strategy_name: str
    symbol: str
    exchange: str
    timeframe: str
    side: Side
    confidence: float
    status: Status = "neutral"
    entry: float | None = None
    stop_loss: float | None = None
    take_profit: list[float] = field(default_factory=list)
    risk_reward: float | None = None
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    candle_time: int | None = None
    created_at: int = field(default_factory=lambda: int(time.time()))
    id: str = ""

    def finalize(self):
        raw = f"{self.strategy_id}:{self.exchange}:{self.symbol}:{self.timeframe}:{self.side}:{self.status}:{self.candle_time}"
        self.id = hashlib.sha1(raw.encode()).hexdigest()[:16]
        return self

    def to_dict(self):
        if not self.id: self.finalize()
        return asdict(self)
