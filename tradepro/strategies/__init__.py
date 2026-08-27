from .trend_pullback import TrendPullback
from .breakout_volume import BreakoutVolume
from .funding_oi_squeeze import FundingOiSqueeze

DEFAULT_STRATEGIES = [TrendPullback(), BreakoutVolume(), FundingOiSqueeze()]
