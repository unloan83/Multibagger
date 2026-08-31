#!/bin/bash
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
export PYTHONPATH=.:.python-packages

echo "[$(date)] Running Pre-Flight Sync..."
python3 engine/main.py --sync

echo "[$(date)] Launching Multibagger Paper Trading Engine..."
python3 engine/main.py --mode paper >> logs/engine_$(date +%Y-%m-%d).log 2>&1 &
ENGINE_PID=$!
echo "Engine running under PID: $ENGINE_PID"

# Wait until 15:30 EOD (or when running manual/cron)
sleep 5

echo "[$(date)] Session initialization complete."
