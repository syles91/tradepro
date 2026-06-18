#!/bin/bash
# TradePro Dashboard Starter (server_v2)
# Manuell: bash /opt/data/crypto-dashboard/start.sh

APP_DIR="/opt/data/crypto-dashboard"
PORT=7777
LOGFILE="/tmp/crypto-dashboard.log"
PIDFILE="/tmp/crypto-dashboard.pid"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "TradePro läuft bereits (PID: $PID) → http://192.168.8.4:$PORT"
    exit 0
  fi
fi

cd "$APP_DIR"
nohup /opt/hermes/.venv/bin/uvicorn server_v2:app \
  --host 0.0.0.0 \
  --port $PORT \
  --log-level warning \
  >> "$LOGFILE" 2>&1 &

echo $! > "$PIDFILE"
echo "✅ TradePro gestartet (PID: $!) → http://192.168.8.4:$PORT"
