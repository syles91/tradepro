from tradepro.core.models import MarketContext, SignalResult

class StrategyBase:
    id = "base"
    name = "Base Strategy"
    description = ""
    default_config = {}

    async def evaluate(self, ctx: MarketContext) -> SignalResult:
        raise NotImplementedError

    def neutral(self, ctx: MarketContext, reasons=None, warnings=None):
        return SignalResult(self.id, self.name, ctx.symbol, ctx.exchange, ctx.timeframe, "neutral", 0, "neutral", reasons=reasons or [], warnings=warnings or [], candle_time=ctx.candle_time).finalize()
