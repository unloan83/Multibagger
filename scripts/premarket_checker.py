#!/usr/bin/env python3
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
        print(f"CODE: FAIL (Settings initialization error: {err})")
        print("CONFIG: FAIL")
        print("DATA: FAIL")
        print("SERVICE: FAIL")
        print("")
        print("PAPER TRADING READY: NO")
        sys.exit(1)

    result = run_premarket_safety_check(settings)
    print(result.summary_text())
    
    if not result.ready:
        sys.exit(1)


if __name__ == "__main__":
    main()
