from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "tradepro.db"
TIMEFRAMES = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"]
EXCHANGES = ["binance", "bybit"]
DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"]
BN_FUT_REST = "https://fapi.binance.com/fapi/v1"
BN_FUT_DATA = "https://fapi.binance.com/futures/data"
BY_REST = "https://api.bybit.com/v5"
BYBIT_TF = {"1m": "1", "3m": "3", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}
