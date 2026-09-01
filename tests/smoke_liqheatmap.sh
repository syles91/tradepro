#!/bin/bash
# End-to-End-Smoke-Test der Liquidation-Heatmap ueber HTTP.
cd /tmp || exit 1
rm -f cj_heat.txt
curl -s -c cj_heat.txt -o /dev/null -X POST http://127.0.0.1:7777/auth/login \
  -d "username=demo&password=demo&next=/"

run() {
  ex=$1; sym=$2; win=$3; thr=$4
  code=$(curl -s -b cj_heat.txt --connect-timeout 30 -o /tmp/hm_smoke.json -w "%{http_code}" \
    "http://127.0.0.1:7777/api/liquidation_heatmap?symbol=$sym&exchange=$ex&window=$win&bins=100&threshold=$thr")
  /opt/hermes/.venv/bin/python - "$ex" "$sym" "$win" "$thr" "$code" <<'PY'
import json, sys
ex, sym, win, thr, code = sys.argv[1:6]
try:
    d = json.load(open('/tmp/hm_smoke.json'))
except Exception as e:
    print(f"FAIL {ex:8s} {sym:8s} {win:3s} thr={thr}  HTTP {code}  unlesbar: {e}"); sys.exit(0)
m = d.get('matrix', [])
cols = len(m); rows = len(m[0]) if m else 0
nz = sum(1 for c in m for v in c if v > 0)
good = (code == '200' and cols > 0 and rows > 0 and nz > 0
        and len(d.get('candles', [])) == cols
        and len(d.get('times', [])) == cols
        and all(c['high'] >= c['low'] for c in d.get('candles', [])))
print(f"{'OK  ' if good else 'FAIL'} {ex:8s} {sym:8s} {win:3s} thr={thr}  HTTP {code}  "
      f"{cols}x{rows}  belegt={nz:5d}  peak={d.get('maxValue',0)/1e6:7.1f}M  "
      f"iv={d.get('interval','?')}")
PY
}

for combo in "binance BTCUSDT 12h 0" "binance BTCUSDT 1d 0" "binance BTCUSDT 3d 0" \
             "binance BTCUSDT 1w 0" "binance BTCUSDT 1m 0" "binance ETHUSDT 1d 0" \
             "binance SOLUSDT 1d 0" "bybit BTCUSDT 1d 0" "bybit ETHUSDT 1w 0" \
             "binance BTCUSDT 1d 0.5" "binance BTCUSDT 1d 0.9"; do
  set -- $combo
  run "$1" "$2" "$3" "$4"
done
