# 🚀 TradePro — Crypto Trading Terminal

> Ein TradingView-ähnliches Krypto-Terminal für Desktop & Mobile.
> Live-Daten von Binance, gebaut mit FastAPI + TradingView Lightweight Charts.

**Live:** http://192.168.8.4:7777
**Stand:** Phase 1 MVP (+ Futures-Daten)

---

## 📑 Inhaltsverzeichnis

1. [Überblick](#überblick)
2. [Architektur](#architektur)
3. [Dateistruktur](#dateistruktur)
4. [Backend (server_v2.py)](#backend)
5. [Frontend (app.html)](#frontend)
6. [Datenfluss — wie Live-Daten funktionieren](#datenfluss)
7. [API-Endpunkte](#api-endpunkte)
8. [WebSocket-Protokoll](#websocket-protokoll)
9. [Netzwerk-Besonderheit (wichtig!)](#netzwerk-besonderheit)
10. [Starten / Stoppen / Neustart](#betrieb)
11. [Routen-Übersicht](#routen)
12. [Roadmap (Phasen)](#roadmap)
13. [Troubleshooting](#troubleshooting)

---

## Überblick

TradePro ist eine Web-App, die Krypto-Futures in Echtzeit visualisiert — ähnlich wie
TradingView oder Coinglass, aber selbst gehostet auf dem Unraid-Server.

**Kern-Features:**
- 📊 Candlestick-Chart mit Volumen (TradingView Lightweight Charts)
- ⚡ Live-Updates: nur die **letzte Kerze** wird aktualisiert, kein Reload
- 🔄 7 Timeframes (1m, 3m, 5m, 15m, 1h, 4h, 1D)
- 🪙 Symbol-Wechsel (8 Coins, durchsuchbar)
- 📈 Indikatoren: EMA-Overlays (9/21/50/200), RSI(14) & MACD(12,26,9) als Sub-Charts — live mitlaufend
- 📦 Open-Interest-Verlauf (Sub-Chart)
- 💸 Funding-Rate live + History
- ⚖️ Long/Short-Ratio (Global + Top Trader)
- 💥 Live-Liquidationen-Feed
- 📱 Voll responsive (Desktop + Mobile mit Bottom-Navigation)

**Warum Web statt Kotlin?** → Desktop + Android + iPhone aus einer Codebase,
beste Chart-Libraries, sofortige Updates. Kotlin kommt später nur als
WebView-Hülle (Phase 5).

---

## Architektur

```
                   ┌─────────────────────────────────┐
                   │         BINANCE                  │
                   │                                  │
   Spot WebSocket  │  stream.binance.com:9443         │  ✅ erreichbar
   (Candles+Trades)│                                  │
                   │  fapi.binance.com (REST)         │  ✅ erreichbar
   Futures REST    │  (Mark, Funding, OI, L/S)        │
                   │                                  │
   Futures WS      │  fstream.binance.com             │  ❌ geblockt
   (Liquidationen) │  (best-effort)                   │
                   └────────────┬────────────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────┐
        │   FastAPI Backend  (server_v2.py)           │
        │                                             │
        │   ┌─────────────┐      ┌──────────────────┐ │
        │   │  Hub         │      │  REST Proxies    │ │
        │   │  - relay()   │      │  /api/klines     │ │
        │   │  - poller()  │      │  /api/oi_hist    │ │
        │   │  - liq_stream│      │  /api/funding... │ │
        │   └──────┬──────┘      └──────────────────┘ │
        │          │ WebSocket /ws                     │
        └──────────┼─────────────────────────────────┘
                   │
                   ▼
        ┌───────────────────────────────────────────┐
        │   Frontend  (static/app.html)               │
        │                                             │
        │   TradingView Lightweight Charts            │
        │   - candleSeries.update()  ← live Kerze     │
        │   - volumeSeries.update()                   │
        │   - subChart (OI / Funding / L-S)           │
        │                                             │
        │   Desktop: Watchlist | Chart | Futures      │
        │   Mobile:  Bottom-Nav (Märkte/Chart/Futures)│
        └───────────────────────────────────────────┘
```

**Designprinzip:** Pro aktivem Symbol/Timeframe hält das Backend genau **einen**
Upstream-Stream zu Binance und verteilt (`relay`) ihn an alle verbundenen Clients.
So skaliert es: 10 Browser-Tabs auf BTC/5m = 1 Binance-Verbindung.

---

## Dateistruktur

```
/opt/data/crypto-dashboard/
├── server_v2.py              # ► AKTIVES Backend (FastAPI + WS-Relay)
├── server.py                 # altes Backend (Cron-Trigger-Dashboard)
├── start.sh                  # Starter-Script (nutzt server_v2)
│
└── static/
    ├── app.html              # ► TradePro Terminal (Hauptfrontend)
    ├── classic.html          # altes Dashboard (Coin-Cards + Job-Buttons)
    ├── index.html            # Quelle für classic
    ├── guide.html            # Lern-/Interpretationshilfe (Indikatoren erklärt)
    └── charts/               # generierte PNG-Charts (vom alten Cron-Job)

Zugehörige Cron-Scripts (separat):
/home/hermes/.hermes/scripts/
├── crypto_full_analysis.py   # Cron-Wrapper (stündlich)
├── crypto_analysis.py        # BTC-Chart + Marktanalyse (matplotlib)
└── coinglass_screenshot.py   # OI/Funding/Liq-Daten (reine Binance API)
```

---

## Backend

**Datei:** `server_v2.py` · **Framework:** FastAPI · **Server:** Uvicorn · **Port:** 7777

### Die `Hub`-Klasse — Herzstück

Verwaltet alle WebSocket-Verbindungen und Binance-Upstreams.

| Methode | Aufgabe |
|---|---|
| `subscribe(ws, symbol, tf)` | Client abonnieren; startet bei Bedarf relay + poller |
| `unsubscribe(ws)` | Client entfernen; stoppt Upstream wenn niemand mehr lauscht |
| `relay(symbol, tf, k)` | **Spot-WS** → verteilt Live-Candles + Trades |
| `futures_poller(symbol)` | **fapi REST alle 3s** → Mark-Preis + Funding |
| `_liq_stream(symbol)` | best-effort **fstream WS** → Live-Liquidationen |
| `push(k, msg)` | sendet an alle Clients eines (Symbol@TF) |
| `push_symbol(symbol, msg)` | sendet an alle Clients eines Symbols (TF-egal) |

### Warum drei Datenquellen?

Binance bietet einen kombinierten Futures-WebSocket, der **alles** (Candles,
Mark, Funding, Liquidationen) auf einmal liefert. **Aber:** Dieser Endpunkt
(`fstream.binance.com`) ist von unserem Container **geblockt**. Deshalb:

- **Candles** → Spot-WebSocket (funktioniert, Preis ≈ identisch zu Futures)
- **Mark/Funding** → Futures-REST-Polling alle 3 Sekunden
- **Liquidationen** → Futures-WS best-effort (bleibt leer wenn geblockt)

→ siehe [Netzwerk-Besonderheit](#netzwerk-besonderheit)

---

## Frontend

**Datei:** `static/app.html` · **Chart-Lib:** TradingView Lightweight Charts 4.2.0 (via CDN)

### Layout

**Desktop (3 Spalten):**
```
┌──────────────────────────────────────────────────────┐
│ TopBar: Logo | Symbol▼ | Preis 24h Hoch Tief Vol OI..│
├──────────────────────────────────────────────────────┤
│ TF-Bar: 1m 3m [5m] 15m 1h 4h 1D | Kerzen              │
├───────────┬──────────────────────────┬───────────────┤
│ Watchlist │   Candlestick-Chart      │  Futures-Daten│
│ BTC  +1%  │   + Volumen              │  Mark/Funding │
│ ETH  -2%  │                          │  OI / Vol     │
│ SOL  ...  │  ┌─ Sub-Chart Tabs ──┐   │  L/S-Balken   │
│           │  │ OI│Funding│L/S│Aus│   │               │
│           │  └────────────────────┘   │  ⚡ Liq-Feed  │
│           │   [Open-Interest-Verlauf] │  LONG  $1.2M  │
└───────────┴──────────────────────────┴───────────────┘
```

**Mobile:** Chart im Vollbild, Watchlist + Futures als Slide-In-Panels über
eine Bottom-Navigation (Märkte / Chart / Futures / Guide).

### State-Objekt (JavaScript)

```javascript
State = {
  symbol: 'BTCUSDT',   // aktuelles Symbol
  tf: '5m',            // aktueller Timeframe
  subType: 'oi',       // Sub-Chart: 'oi'|'funding'|'ls'|'none'
  candles: [...],      // geladene historische Kerzen
  lastCandle: {...},   // letzte (live aktualisierte) Kerze
  ws: WebSocket,       // Verbindung zum Backend
}
```

### Die wichtigsten Funktionen

| Funktion | Was sie tut |
|---|---|
| `loadChart()` | holt 500 historische Kerzen via `/api/klines`, setzt Chart |
| `connectWS()` | öffnet WebSocket, auto-reconnect bei Abbruch |
| `handleWS(msg)` | verteilt Live-Nachrichten (kline/mark/liq/trade) |
| `switchSymbol(sym)` | Symbol wechseln → alles neu laden + neu abonnieren |
| `switchTF(tf)` | Timeframe wechseln |
| `switchSub(type)` | Sub-Chart umschalten (OI/Funding/L-S) |
| `loadWatchlist()` | Watchlist-Preise (alle 15s) |

---

## Datenfluss

### So entsteht eine Live-Kerze (Kern-Mechanik)

```
1. Browser lädt Seite
       │
       ▼
2. loadChart() → GET /api/klines?symbol=BTCUSDT&tf=5m&limit=500
       │         → 500 historische Kerzen → candleSeries.setData(...)
       ▼
3. connectWS() → WebSocket /ws
       │         → send {action:'subscribe', symbol:'BTCUSDT', tf:'5m'}
       ▼
4. Backend Hub.subscribe()
       │  ├─ relay() verbindet zu Spot-WS  (kline_5m + aggTrade)
       │  └─ futures_poller() startet fapi-Polling (Mark/Funding)
       ▼
5. Binance sendet alle ~2s ein kline-Update
       │
       ▼
6. relay() → push() → Browser empfängt {type:'kline', candle:{...}}
       │
       ▼
7. handleWS() → candleSeries.update({time, open, high, low, close})
       │         ↑ NUR die letzte Kerze wird verändert,
       │           Chart wird NICHT neu gezeichnet!
       ▼
8. Wenn neue 5m-Periode beginnt → Binance schickt neue Kerze (closed:true)
   → automatisch neue Kerze, weil sich der `time`-Wert ändert
```

**Das ist die offizielle Lightweight-Charts-Mechanik:** `series.update(candle)`
mit gleichem `time` = letzte Kerze ändern, mit neuem `time` = neue Kerze anhängen.

---

## API-Endpunkte

Alle liefern JSON. Basis: `http://192.168.8.4:7777`

| Endpunkt | Parameter | Liefert |
|---|---|---|
| `GET /api/klines` | `symbol`, `tf`, `limit` | historische Kerzen `[{time,open,high,low,close,volume}]` |
| `GET /api/ticker` | `symbol` | 24h-Statistik + OI für ein Symbol |
| `GET /api/tickers` | — | Watchlist-Daten aller Default-Symbole |
| `GET /api/oi_hist` | `symbol`, `period`, `limit` | Open-Interest-Verlauf |
| `GET /api/funding_hist` | `symbol`, `limit` | Funding-Rate-Historie |
| `GET /api/ls_hist` | `symbol`, `period`, `limit` | Long/Short Global + Top Trader |
| `GET /api/liquidations` | `symbol` | gepufferte Liquidationen (max 50) |
| `GET /api/symbols` | — | verfügbare Symbole + Timeframes |

**Beispiel:**
```bash
curl "http://192.168.8.4:7777/api/klines?symbol=ETHUSDT&tf=1h&limit=100"
```

---

## WebSocket-Protokoll

**Endpunkt:** `ws://192.168.8.4:7777/ws`

### Client → Server

```json
{ "action": "subscribe", "symbol": "BTCUSDT", "tf": "5m" }
{ "action": "ping" }
```

### Server → Client

| `type` | Inhalt | Quelle |
|---|---|---|
| `subscribed` | Bestätigung | — |
| `kline` | `{candle:{time,open,high,low,close,volume,closed}}` | Spot-WS |
| `trade` | `{price, qty, buyerMaker, time}` | Spot-WS |
| `mark` | `{price, funding, nextFundingTime}` | fapi REST (3s) |
| `liq` | `{side, price, qty, usd, time}` | fstream (best-effort) |
| `pong` | Antwort auf ping | — |

**Beispiel kline-Nachricht:**
```json
{
  "type": "kline",
  "symbol": "BTCUSDT",
  "tf": "5m",
  "candle": {
    "time": 1781677200,
    "open": 65848.8, "high": 65850.2, "low": 65819.0, "close": 65824.3,
    "volume": 70.178, "closed": false
  }
}
```

---

## Netzwerk-Besonderheit

> ⚠️ **WICHTIG für Verständnis & Debugging**

Dieser Unraid-Container kann **NICHT** auf den Binance-Futures-WebSocket
`fstream.binance.com` zugreifen — Verbindungsversuche enden im **TimeoutError**.

**Was funktioniert:**
| Endpunkt | Status | Genutzt für |
|---|---|---|
| `stream.binance.com:9443` (Spot-WS) | ✅ | Live-Candles + Trades |
| `fapi.binance.com` (Futures-REST) | ✅ | Mark, Funding, OI, L/S, klines |
| `fstream.binance.com` (Futures-WS) | ❌ Timeout | nur best-effort Liquidationen |

**Konsequenz im Code:**
- Candles kommen vom **Spot**-Stream (Preis praktisch identisch zu Futures)
- Mark-Preis & Funding über **REST-Polling alle 3 Sekunden** statt Push
- Der Liquidationen-Feed bleibt leer, solange fstream geblockt ist —
  das ist **kein Bug**, sondern die Netzwerk-Einschränkung

Falls der Block später wegfällt (VPN, anderer Host), liefert `_liq_stream()`
automatisch Live-Liquidationen ohne Code-Änderung.

---

## Betrieb

### Starten
```bash
bash /opt/data/crypto-dashboard/start.sh
# → ✅ TradePro gestartet (PID: ...) → http://192.168.8.4:7777
```

### Status prüfen
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:7777/
# → 200
```

### Stoppen
```bash
kill $(cat /tmp/crypto-dashboard.pid)
```

### Neustart (nach Code-Änderung)
```bash
kill $(cat /tmp/crypto-dashboard.pid) 2>/dev/null
sleep 1
bash /opt/data/crypto-dashboard/start.sh
```

### Logs
```bash
tail -f /tmp/crypto-dashboard.log
```

### Manuell im Vordergrund (zum Debuggen)
```bash
cd /opt/data/crypto-dashboard
/opt/hermes/.venv/bin/uvicorn server_v2:app --host 0.0.0.0 --port 7777
```

---

## Routen

| URL | Inhalt |
|---|---|
| `/` | **TradePro Terminal** (app.html) — das Hauptprodukt |
| `/classic` | altes Dashboard (Coin-Cards + Cron-Job-Buttons) |
| `/guide` | Interpretationshilfe — alle Indikatoren erklärt mit Beispielen |
| `/static/...` | statische Dateien |

---

## Roadmap

| Phase | Status | Inhalt |
|---|---|---|
| **1 — MVP** | ✅ fertig | Live-Chart, Candles, Volume, WS-Update, 1 Börse |
| **2 — Multi-Exchange** | ✅ fertig | Binance + Bybit + Exchange-Umschalter |
| **3 — Futures-Daten** | ✅ fertig | OI, Funding, L/S; Live-Liquidationen via Bybit |
| **4 — Profi-Chart** | ✅ fertig | Volume Profile (POC/VAH/VAL), CVD, Orderbook + Depth Chart |
| **4.5 — KI-Assistent** | ✅ fertig | Claude-Markt-Analyst im Terminal (Drawer, SSE-Stream, Freitextfragen) |
| **5 — Mobile App** | 🔲 geplant | Kotlin WebView-Hülle + Push-Notifications |
| **6 — Autonome Beurteilung** | 🔲 vorbereitet | Cron beurteilt Markt bei Signalen selbständig (nutzt gather_snapshot) |

### KI-Assistent (ai_assistant.py)
- **Modell:** claude-sonnet-4-5 (Anthropic, Key aus Hermes .env)
- **`gather_snapshot(symbol, tf, exchange)`** — sammelt kompakten Markt-Snapshot:
  RSI, MACD, EMA20/50/200, Trend, 24h-Change, Volumen, OI + OI-Trend, Funding,
  Long/Short (global+top), CVD-Trend, Volume Profile (POC/VAH/VAL + Lage),
  Orderbook-Imbalance. Diese Funktion ist BEWUSST wiederverwendbar — der spätere
  autonome Cron-Beobachter (Phase 6) nutzt exakt dieselbe Basis.
- **`stream_analysis(snap, liq_sum, question)`** — async Claude-Streaming.
- **Endpunkte:** `/api/ai/health`, `/api/ai/analyze` (SSE: snapshot → chunks → done).
- **Frontend:** 🤖-Button (Topbar + Mobile-Nav) öffnet Drawer. "Markt analysieren"
  oder eigene Freitextfrage. Antwort streamt live mit Markdown-Formatierung.

### Phase-4 Features
- **Volume Profile** (`/api/volume_profile`): Volume-by-Price-Histogramm als
  Canvas-Overlay links im Chart. POC (gelb), Value Area 70% (VAH/VAL blau).
  Toggle-Buttons "VP" (Histogramm) und "POC/VA" (Preislinien) in der TF-Leiste.
- **CVD** (`/api/cvd`): Cumulative Volume Delta als Sub-Chart-Tab. Delta =
  2*takerBuy - totalVol pro Kerze, kumuliert. Immer Binance (tiefste Liquidität).
- **Orderbook** (`/api/orderbook`): Sidebar-Tab "Orderbook" mit Bid/Ask-Liste,
  Tiefenbalken, Spread, Imbalance-Anzeige und kumulativem Depth-Chart (Canvas).
  Polling alle 2s nur wenn Tab aktiv. Beide Exchanges.

### Multi-Exchange-Hinweise
- **Binance:** Candles via Spot-WS, Mark/Funding via fapi REST (3s).
  Live-Liquidationen NICHT verfügbar (fstream geblockt).
- **Bybit:** ALLES aus einem WS-Stream (`stream.bybit.com/v5/public/linear`):
  Candles, Ticker (Mark+Funding+OI live), **Live-Liquidationen** (`allLiquidation`).
  → Für Live-Liquidationen Bybit wählen.
- Long/Short Ratio kommt für beide Exchanges von Binance (Bybit hat keinen Endpoint).

### Stack-Erweiterungen für spätere Phasen
- **Redis** — Cache + Pub/Sub für Multi-Exchange-Fanout
- **TimescaleDB** — historische Kerzen/Trades/Liquidationen persistent
- **Next.js/React** — wenn das Frontend komplexer wird (optional)
- **Docker-Compose** — sauberes Deployment auf Unraid

---

## Troubleshooting

**Seite lädt, aber Chart bleibt leer / "Lade Chart…"**
→ Backend prüfen: `curl http://localhost:7777/api/klines?symbol=BTCUSDT&tf=5m&limit=3`
→ Wenn leer: Binance-REST nicht erreichbar (Netzwerk).

**Preise aktualisieren sich nicht live**
→ WebSocket prüfen: Verbindungs-Punkt oben rechts muss **grün** pulsieren.
→ Wenn grau: WebSocket-Verbindung fehlgeschlagen, Browser-Konsole checken.

**Liquidationen-Feed bleibt leer**
→ Erwartetes Verhalten (fstream geblockt). Kein Bug.

**Server startet nicht**
→ Port belegt? `kill $(cat /tmp/crypto-dashboard.pid)`
→ Import-Fehler? `cd /opt/data/crypto-dashboard && /opt/hermes/.venv/bin/python3 -c "import server_v2"`

**Funding zeigt "–"**
→ fapi REST-Polling braucht ~3s nach Verbindung. Kurz warten.

---

## Tech-Stack-Zusammenfassung

```
Backend:    FastAPI + Uvicorn (Python 3.13, /opt/hermes/.venv)
Live:       WebSocket (FastAPI) + websockets-Lib (Binance-Upstream)
HTTP:       httpx (async REST-Calls)
Frontend:   Vanilla JS + TradingView Lightweight Charts 4.2.0
Daten:      Binance Spot-WS + Futures-REST
Hosting:    Unraid Docker-Container (192.168.8.4:7777)
```

---

*Erstellt für Master · Phase 1 MVP · Kein Finanzrat — nur zu Informationszwecken.*
