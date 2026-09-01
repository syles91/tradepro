#!/bin/bash
# Regressionslauf aller Frontend-Tests von TradePro.
cd /opt/data/crypto-dashboard || exit 1
export NODE_PATH=/tmp/tp_dom/node_modules
fail=0
for f in tests/*.test.js; do
  name=$(basename "$f")
  if out=$(node "$f" 2>&1); then
    echo "OK   $name"
  else
    echo "FAIL $name"
    echo "$out" | grep FAIL | head -5
    fail=1
  fi
done
exit $fail
