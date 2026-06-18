from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

# Binance
BN_FUT_REST = "https://fapi.binance.com/fapi/v1"
BN_FUT_DATA = "https://fapi.binance.com/futures/data"
BN_SPOT_WS = "wss://stream.binance.com:9443/stream"
BN_FUT_WS = "wss://fstream.binance.com/stream"

# Bybit
BY_REST = "https://api.bybit.com/v5"
BY_WS = "wss://stream.bybit.com/v5/public/linear"

TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"]
BYBIT_TF = {"1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}

EXCHANGES = ["binance", "bybit"]
DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"]
