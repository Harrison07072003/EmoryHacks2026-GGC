#!/usr/bin/env bash
# npm run typesense  — start a standalone Typesense server (no Docker, no sudo).
#
# - Reads game/.env (TYPESENSE_ADMIN_API_KEY, TYPESENSE_PORT).
# - Does nothing if Typesense already answers on that port.
# - Downloads the pinned Typesense release once (checksum-verified) into TYPESENSE_HOME.
# - Keeps data in TYPESENSE_DATA_DIR, outside the repo, so it survives workspace restarts.
#
# Defaults (override in game/.env):
#   TYPESENSE_HOME=~/.local/share/rhythmeyez/typesense      binary + log + pid
#   TYPESENSE_DATA_DIR=$TYPESENSE_HOME/data
set -euo pipefail

VERSION=30.2
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# load .env without overriding variables already set in the shell
for f in "$GAME_DIR/.env.local" "$GAME_DIR/.env"; do
  [[ -f "$f" ]] || continue
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [[ -n "${!key:-}" ]] && continue
    value="${value%\"}"; value="${value#\"}"
    export "$key=$value"
  done < "$f"
done

PORT="${TYPESENSE_PORT:-8108}"
HOME_DIR="${TYPESENSE_HOME:-$HOME/.local/share/rhythmeyez/typesense}"
DATA_DIR="${TYPESENSE_DATA_DIR:-$HOME_DIR/data}"
BIN="$HOME_DIR/$VERSION/typesense-server"
LOG="$HOME_DIR/typesense.log"
PID_FILE="$HOME_DIR/typesense.pid"

if [[ -z "${TYPESENSE_ADMIN_API_KEY:-}" || "$TYPESENSE_ADMIN_API_KEY" == change-me* ]]; then
  echo "Set TYPESENSE_ADMIN_API_KEY in game/.env first (copy .env.example)." >&2
  exit 2
fi

if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "Typesense is already running on port $PORT."
  exit 0
fi

if [[ ! -x "$BIN" ]]; then
  echo "Downloading Typesense $VERSION (about 150 MB, once)..."
  mkdir -p "$HOME_DIR/$VERSION"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  url="https://dl.typesense.org/releases/$VERSION/typesense-server-$VERSION-linux-amd64.tar.gz"
  [[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]] && url="${url/amd64/arm64}"
  [[ "$(uname -s)" == "Darwin" ]] && url="${url/linux/darwin}"
  curl -fL --retry 3 -o "$tmp/ts.tar.gz" "$url"
  tar -xzf "$tmp/ts.tar.gz" -C "$tmp"
  expected="$(cut -d' ' -f1 < "$tmp/typesense-server.md5.txt")"
  actual="$( (md5sum "$tmp/typesense-server" 2>/dev/null || md5 -r "$tmp/typesense-server") | cut -d' ' -f1)"
  if [[ "$expected" != "$actual" ]]; then echo "Checksum mismatch for the Typesense download." >&2; exit 1; fi
  mv "$tmp/typesense-server" "$BIN"
  chmod +x "$BIN"
fi

mkdir -p "$DATA_DIR"
echo "Starting Typesense $VERSION on port $PORT (data: $DATA_DIR, log: $LOG)"
nohup "$BIN" --data-dir="$DATA_DIR" --api-key="$TYPESENSE_ADMIN_API_KEY" --api-port="$PORT" --enable-cors >"$LOG" 2>&1 &
echo $! > "$PID_FILE"

for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then echo "Typesense is ready."; exit 0; fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then echo "Typesense exited. Last log lines:" >&2; tail -20 "$LOG" >&2; exit 1; fi
  sleep 0.5
done
echo "Typesense did not become healthy within 30 s; see $LOG" >&2
exit 1
