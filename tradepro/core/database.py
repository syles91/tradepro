import json
import sqlite3
import time
from .config import DB_PATH, DATA_DIR


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(mode=0o700, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def migrate() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS strategies (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                config_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS signals (
                id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                strategy_name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                exchange TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                side TEXT NOT NULL,
                confidence REAL NOT NULL,
                entry REAL,
                stop_loss REAL,
                take_profit_json TEXT NOT NULL DEFAULT '[]',
                risk_reward REAL,
                status TEXT NOT NULL,
                reasons_json TEXT NOT NULL DEFAULT '[]',
                warnings_json TEXT NOT NULL DEFAULT '[]',
                candle_time INTEGER,
                created_at INTEGER NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_signals_strategy ON signals(strategy_id, created_at DESC)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS signal_outcomes (
                signal_id TEXT PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
                outcome TEXT NOT NULL,
                exit_price REAL,
                exit_time INTEGER,
                r_multiple REAL,
                max_favorable_excursion REAL,
                max_adverse_excursion REAL,
                updated_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS backtest_runs (
                id TEXT PRIMARY KEY,
                strategy_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                exchange TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                config_json TEXT NOT NULL DEFAULT '{}',
                result_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                signal_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                sent_at INTEGER NOT NULL
            )
        """)


def upsert_strategy(meta: dict) -> None:
    now = int(time.time())
    with connect() as conn:
        row = conn.execute("SELECT id FROM strategies WHERE id=?", (meta["id"],)).fetchone()
        if row:
            conn.execute("UPDATE strategies SET name=?, description=?, updated_at=? WHERE id=?",
                         (meta["name"], meta.get("description", ""), now, meta["id"]))
        else:
            conn.execute("INSERT INTO strategies(id,name,description,enabled,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
                         (meta["id"], meta["name"], meta.get("description", ""), 1, json.dumps(meta.get("default_config", {})), now, now))


def strategy_rows():
    with connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM strategies ORDER BY name")]


def strategy_enabled(strategy_id: str) -> bool:
    with connect() as conn:
        row = conn.execute("SELECT enabled FROM strategies WHERE id=?", (strategy_id,)).fetchone()
        return bool(row["enabled"]) if row else True


def set_strategy_enabled(strategy_id: str, enabled: bool) -> None:
    with connect() as conn:
        conn.execute("UPDATE strategies SET enabled=?, updated_at=? WHERE id=?", (1 if enabled else 0, int(time.time()), strategy_id))


def save_signal(sig: dict) -> None:
    with connect() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO signals(id,strategy_id,strategy_name,symbol,exchange,timeframe,side,confidence,entry,stop_loss,take_profit_json,risk_reward,status,reasons_json,warnings_json,candle_time,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (sig["id"], sig["strategy_id"], sig["strategy_name"], sig["symbol"], sig["exchange"], sig["timeframe"], sig["side"], sig["confidence"], sig.get("entry"), sig.get("stop_loss"), json.dumps(sig.get("take_profit", [])), sig.get("risk_reward"), sig["status"], json.dumps(sig.get("reasons", []), ensure_ascii=False), json.dumps(sig.get("warnings", []), ensure_ascii=False), sig.get("candle_time"), sig["created_at"]))


def signal_history(limit=100, strategy_id=None, symbol=None):
    clauses=[]; args=[]
    if strategy_id: clauses.append("strategy_id=?"); args.append(strategy_id)
    if symbol: clauses.append("symbol=?"); args.append(symbol.upper())
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with connect() as conn:
        rows = conn.execute(f"SELECT * FROM signals{where} ORDER BY created_at DESC LIMIT ?", (*args, int(limit))).fetchall()
    out=[]
    for r in rows:
        d=dict(r); d["take_profit"]=json.loads(d.pop("take_profit_json") or "[]"); d["reasons"]=json.loads(d.pop("reasons_json") or "[]"); d["warnings"]=json.loads(d.pop("warnings_json") or "[]"); out.append(d)
    return out


def analytics_overview():
    with connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
        confirmed = conn.execute("SELECT COUNT(*) FROM signals WHERE status='confirmed'").fetchone()[0]
        watch = conn.execute("SELECT COUNT(*) FROM signals WHERE status='watch'").fetchone()[0]
        avg_conf = conn.execute("SELECT AVG(confidence) FROM signals").fetchone()[0] or 0
        by_strategy = [dict(r) for r in conn.execute("SELECT strategy_name, COUNT(*) signals, AVG(confidence) avg_confidence, SUM(CASE WHEN side='long' THEN 1 ELSE 0 END) longs, SUM(CASE WHEN side='short' THEN 1 ELSE 0 END) shorts FROM signals GROUP BY strategy_id, strategy_name ORDER BY signals DESC")]
        by_tf = [dict(r) for r in conn.execute("SELECT timeframe, COUNT(*) signals, AVG(confidence) avg_confidence FROM signals GROUP BY timeframe ORDER BY signals DESC")]
        by_symbol = [dict(r) for r in conn.execute("SELECT symbol, COUNT(*) signals, AVG(confidence) avg_confidence FROM signals GROUP BY symbol ORDER BY signals DESC LIMIT 20")]
    return {"total_signals": total, "confirmed_signals": confirmed, "watch_signals": watch, "avg_confidence": round(avg_conf, 1), "by_strategy": by_strategy, "by_timeframe": by_tf, "by_symbol": by_symbol}
