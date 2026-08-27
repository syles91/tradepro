#!/bin/bash
# TradePro Dashboard Starter (server_v2)
# Manuell: bash /opt/data/crypto-dashboard/start.sh

APP_DIR="/opt/data/crypto-dashboard"
PORT=7777
HOST_IP="192.168.8.151"
LOGFILE="/tmp/crypto-dashboard.log"
PIDFILE="/tmp/crypto-dashboard.pid"
UVICORN="/opt/hermes/.venv/bin/uvicorn"

cd "$APP_DIR" || exit 1

# Wenn die App bereits antwortet, nicht doppelt starten.
if curl -fsS --connect-timeout 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  echo "TradePro läuft bereits → http://$HOST_IP:$PORT"
  exit 0
fi

# Stale PID-Datei bereinigen.
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PIDFILE"
  fi
fi

nohup "$UVICORN" server_v2:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --log-level warning \
  >> "$LOGFILE" 2>&1 &

PID=$!
echo "$PID" > "$PIDFILE"

# Kurz verifizieren statt blind Erfolg melden.
for _ in 1 2 3 4 5; do
  if curl -fsS --connect-timeout 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    echo "✅ TradePro gestartet (PID: $PID) → http://$HOST_IP:$PORT"
    exit 0
  fi
  sleep 1
done

echo "❌ TradePro konnte nicht verifiziert werden. Log: $LOGFILE" >&2
exit 1
