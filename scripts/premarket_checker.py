#!/usr/bin/env python3
"""
Pre-Market Readiness Checker Script
Executes 14 operational checks across service, REST data, data freshness, universe,
engine identity, scanner, execution, risk, DB, storage, CPU/RAM headroom, Telegram,
learning state, and scheduler.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Fix parent package resolution when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import Settings
from engine.premarket_check import run_premarket_safety_check


def main():
    if "MARKET_DATA_DB" not in os.environ:
        upstox_db = Path("/var/lib/multibagger/upstox_market_data.duckdb")
        if upstox_db.exists():
            os.environ["MARKET_DATA_DB"] = str(upstox_db)
    try:
        settings = Settings.from_env()
    except Exception as err:
        print(f"PREMARKET CHECK FAILED (Settings initialization error: {err})")
        sys.exit(1)

    result = run_premarket_safety_check(settings)
    print(result.summary_text())
    
    if not result.ready:
        sys.exit(1)


if __name__ == "__main__":
    main()
