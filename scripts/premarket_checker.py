#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

# Fix parent package resolution when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.config import Settings
from engine.premarket_check import run_premarket_safety_check


def main():
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
