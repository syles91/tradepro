import json, time, uuid
from tradepro.core import database as db

DEFAULT_BALANCE = 10000.0


def migrate():
    with db.connect() as conn:
        conn.execute("""
          CREATE TABLE IF NOT EXISTS app_settings(
            username TEXT NOT NULL,
            key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(username,key)
          )
        """)
        conn.execute("""
          CREATE TABLE IF NOT EXISTS paper_accounts(
            username TEXT PRIMARY KEY,
            balance REAL NOT NULL,
            equity REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USDT',
            risk_per_trade REAL NOT NULL DEFAULT 1.0,
            max_leverage REAL NOT NULL DEFAULT 3.0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        """)
        conn.execute("""
          CREATE TABLE IF NOT EXISTS paper_positions(
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            symbol TEXT NOT NULL,
            exchange TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            side TEXT NOT NULL,
            qty REAL NOT NULL,
            entry REAL NOT NULL,
            stop_loss REAL,
            take_profit_json TEXT NOT NULL DEFAULT '[]',
            signal_id TEXT,
            status TEXT NOT NULL DEFAULT 'OPEN',
            opened_at INTEGER NOT NULL,
            closed_at INTEGER,
            exit_price REAL,
            pnl REAL
          )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_paper_pos_user ON paper_positions(username,status,opened_at DESC)")
        conn.execute("""
          CREATE TABLE IF NOT EXISTS paper_trades(
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            position_id TEXT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            qty REAL NOT NULL,
            price REAL NOT NULL,
            pnl REAL NOT NULL DEFAULT 0,
            kind TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )
        """)


def ensure_account(username):
    migrate(); now=int(time.time())
    with db.connect() as conn:
        row=conn.execute("SELECT * FROM paper_accounts WHERE username=?", (username,)).fetchone()
        if not row:
            conn.execute("INSERT INTO paper_accounts(username,balance,equity,currency,risk_per_trade,max_leverage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", (username,DEFAULT_BALANCE,DEFAULT_BALANCE,'USDT',1.0,3.0,now,now))
            row=conn.execute("SELECT * FROM paper_accounts WHERE username=?", (username,)).fetchone()
        return dict(row)


def get_setting(username, key, default=None):
    migrate()
    with db.connect() as conn:
        r=conn.execute("SELECT value_json FROM app_settings WHERE username=? AND key=?", (username,key)).fetchone()
    return json.loads(r['value_json']) if r else default


def set_setting(username, key, value):
    migrate(); now=int(time.time())
    with db.connect() as conn:
        conn.execute("INSERT INTO app_settings(username,key,value_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(username,key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at", (username,key,json.dumps(value),now))
    return value


def settings(username):
    return {
      'signal_timeframes': get_setting(username,'signal_timeframes',['5m','15m','1h']),
      'demo_balance': ensure_account(username)['balance'],
      'risk_per_trade': ensure_account(username)['risk_per_trade'],
      'max_leverage': ensure_account(username)['max_leverage'],
      'auto_paper': get_setting(username,'auto_paper',False),
      'min_signal_confidence': get_setting(username,'min_signal_confidence',65),
    }


def update_account(username, balance=None, risk_per_trade=None, max_leverage=None):
    ensure_account(username); now=int(time.time())
    with db.connect() as conn:
        if balance is not None:
            conn.execute("UPDATE paper_accounts SET balance=?, equity=?, updated_at=? WHERE username=?", (float(balance),float(balance),now,username))
        if risk_per_trade is not None:
            conn.execute("UPDATE paper_accounts SET risk_per_trade=?, updated_at=? WHERE username=?", (float(risk_per_trade),now,username))
        if max_leverage is not None:
            conn.execute("UPDATE paper_accounts SET max_leverage=?, updated_at=? WHERE username=?", (float(max_leverage),now,username))
    return ensure_account(username)


def list_positions(username, status=None):
    ensure_account(username)
    q="SELECT * FROM paper_positions WHERE username=?"; args=[username]
    if status: q += " AND status=?"; args.append(status)
    q += " ORDER BY opened_at DESC LIMIT 200"
    with db.connect() as conn:
        rows=conn.execute(q,args).fetchall()
    out=[]
    for r in rows:
        d=dict(r); d['take_profit']=json.loads(d.pop('take_profit_json') or '[]'); out.append(d)
    return out


def account_summary(username):
    acct=ensure_account(username)
    positions=list_positions(username,'OPEN')
    with db.connect() as conn:
        trades=[dict(r) for r in conn.execute("SELECT * FROM paper_trades WHERE username=? ORDER BY created_at DESC LIMIT 100", (username,)).fetchall()]
    realized=sum(t.get('pnl') or 0 for t in trades)
    return {'account':acct,'open_positions':positions,'recent_trades':trades,'realized_pnl':round(realized,2)}


def open_position(username, signal, price=None):
    acct=ensure_account(username); entry=float(price or signal.get('entry') or 0)
    sl=float(signal.get('stop_loss') or 0)
    if not entry or not sl: raise ValueError('signal needs entry and stop_loss')
    risk_amt=acct['balance'] * (acct['risk_per_trade']/100.0)
    risk_per_unit=abs(entry-sl) or entry*0.01
    qty=risk_amt/risk_per_unit
    max_notional=acct['balance']*acct['max_leverage']
    qty=min(qty, max_notional/entry)
    pid=str(uuid.uuid4())[:12]; now=int(time.time())
    with db.connect() as conn:
        conn.execute("INSERT INTO paper_positions(id,username,symbol,exchange,timeframe,side,qty,entry,stop_loss,take_profit_json,signal_id,status,opened_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (pid,username,signal['symbol'],signal.get('exchange','binance'),signal.get('timeframe','5m'),signal['side'],qty,entry,sl,json.dumps(signal.get('take_profit',[])),signal.get('id'),'OPEN',now))
        conn.execute("INSERT INTO paper_trades(id,username,position_id,symbol,side,qty,price,pnl,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4())[:12],username,pid,signal['symbol'],signal['side'],qty,entry,0,'OPEN',now))
    return list_positions(username,'OPEN')[0]


def close_position(username, position_id, price):
    price=float(price); now=int(time.time())
    with db.connect() as conn:
        p=conn.execute("SELECT * FROM paper_positions WHERE id=? AND username=? AND status='OPEN'", (position_id,username)).fetchone()
        if not p: raise ValueError('open position not found')
        pnl=(price-p['entry'])*p['qty'] if p['side']=='long' else (p['entry']-price)*p['qty']
        conn.execute("UPDATE paper_positions SET status='CLOSED', closed_at=?, exit_price=?, pnl=? WHERE id=?", (now,price,pnl,position_id))
        conn.execute("UPDATE paper_accounts SET balance=balance+?, equity=equity+?, updated_at=? WHERE username=?", (pnl,pnl,now,username))
        conn.execute("INSERT INTO paper_trades(id,username,position_id,symbol,side,qty,price,pnl,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (str(uuid.uuid4())[:12],username,position_id,p['symbol'], 'sell' if p['side']=='long' else 'buy', p['qty'],price,pnl,'CLOSE',now))
    return account_summary(username)
