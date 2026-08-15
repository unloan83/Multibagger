#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
from datetime import date

from engine.collector import collect, run_worker
from engine.config import Settings
from engine.scanner import run_scan


parser = argparse.ArgumentParser()
parser.add_argument("command", choices=("backfill", "breeze-warmup", "collect", "worker", "scan", "backtest"))
parser.add_argument("--start")
parser.add_argument("--end")
parser.add_argument("--scan-interval", type=int, default=60)
parser.add_argument("--days", type=int, default=8)
parser.add_argument("--no-resume", action="store_true")
args = parser.parse_args()
settings = Settings.from_env()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
if args.command == "backfill":
    from engine.backfill import backfill
    print(json.dumps(backfill(settings, date.fromisoformat(args.start or "2022-01-01"),
                              date.fromisoformat(args.end) if args.end else None,
                              resume=not args.no_resume), indent=2))
elif args.command == "breeze-warmup":
    from features.breeze.python.breeze_backfill import warmup_breeze
    print(json.dumps(warmup_breeze(settings, args.days), indent=2))
elif args.command == "collect":
    collect(settings)
elif args.command == "worker":
    run_worker(settings, args.scan_interval)
elif args.command == "scan":
    print(json.dumps(run_scan(settings), indent=2))
else:
    if not args.start or not args.end:
        parser.error("backtest requires --start and --end")
    from engine.backtest import walk_forward
    print(json.dumps(walk_forward(settings, args.start, args.end), indent=2))
