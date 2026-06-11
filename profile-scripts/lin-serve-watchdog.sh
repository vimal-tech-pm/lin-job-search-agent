#!/usr/bin/env bash
# lin-serve-watchdog.sh — ensure lin-serve is running, start it if not.
# Designed for no_agent=true cron (silent when healthy, chatty on action).
set -euo pipefail

VAULT="$LIN_REAL_HOME/.hermes/profiles/lin/lin"
PORT=7777
LOG="$VAULT/logs/lin-serve.log"

# Check if port is already listening
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  # Already running — silent exit (watchdog pattern)
  exit 0
fi

# Not running — start it
mkdir -p "$VAULT/logs"
nohup node "$VAULT/scripts/lin-serve.mjs" >> "$LOG" 2>&1 &
PID=$!

# Verify it came up within 3 seconds
sleep 2
if kill -0 "$PID" 2>/dev/null && ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  echo "lin-serve started (pid=$PID, port=$PORT, vault=$VAULT)"
else
  echo "lin-serve FAILED to start — check $LOG"
  exit 1
fi
