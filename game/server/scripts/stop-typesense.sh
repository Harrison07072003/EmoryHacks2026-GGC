#!/usr/bin/env bash
# npm run typesense:stop — stop the standalone Typesense started by start-typesense.sh.
set -euo pipefail
HOME_DIR="${TYPESENSE_HOME:-$HOME/.local/share/rhythmeyez/typesense}"
PID_FILE="$HOME_DIR/typesense.pid"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  for _ in $(seq 1 40); do kill -0 "$(cat "$PID_FILE")" 2>/dev/null || break; sleep 0.25; done
  rm -f "$PID_FILE"
  echo "Typesense stopped."
else
  echo "Typesense is not running (no live pid in $PID_FILE)."
fi
