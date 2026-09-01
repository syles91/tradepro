#!/bin/bash
# End-to-End-Smoke-Test des Liquidation-Map-Endpoints ueber HTTP.
cd /tmp || exit 1
rm -f cj_smoke.txt
curl -s -c cj_smoke.txt -o /dev/null -X POST http://127.0.0.1:7777/auth/login \
  -d "username=demo&password=demo&next=/"

for combo in "binance BTCUSDT 12h" "binance BTCUSDT 1d" "binance BTCUSDT 3d" \
             "binance BTCUSDT 1w" "binance BTCUSDT 1m" "binance ETHUSDT 1d" \
             "binance SOLUSDT 1d" "bybit BTCUSDT 1d" "bybit ETHUSDT 1w"; do
  set -- $combo
  ex=$1; sym=$2; win=$3
  code=$(curl -s -b cj_smoke.txt --connect-timeout 25 -o /tmp/lm_smoke.json -w "%{http_code}" \
    "http://127.0.0.1:7777/api/liquidation_map?symbol=$sym&exchange=$ex&window=$win&bins=90")
  /opt/hermes/.venv/bin/python - "$ex" "$sym" "$win" "$code" <<'PY'
import json, sys
ex, sym, win, code = sys.argv[1:5]
try:
    d = json.load(open('/tmp/lm_smoke.json'))
except Exception as e:
    print(f"FAIL {ex:8s} {sym:8s} {win:3s}  HTTP {code}  unlesbar: {e}"); sys.exit(0)
n = len(d.get('levels', []))
okc = code == '200' and n > 0 and d.get('price', 0) > 0
print(f"{'OK  ' if okc else 'FAIL'} {ex:8s} {sym:8s} {win:3s}  HTTP {code}  "
      f"levels={n:3d}  price={d.get('price',0):.2f}  "
      f"total={d.get('totalUsd',0)/1e9:.2f}B  tiers={len(d.get('tiers',[]))}")
PY
done
