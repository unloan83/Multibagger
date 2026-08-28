#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import threading
from datetime import date

from engine.collector import collect, run_worker
from engine.config import Settings
from engine.scanner import run_scan


from scripts.telegram_control import TelegramController


import gc
import sys

parser = argparse.ArgumentParser()
parser.add_argument("command", choices=("backfill", "upstox-warmup", "collect", "worker", "scan", "monitor", "backtest", "replay"))
parser.add_argument("--start")
parser.add_argument("--end")
parser.add_argument("--scan-interval", type=int, default=900)
parser.add_argument("--monitor-interval", type=int, default=30)
parser.add_argument("--scan-max-runtime", type=int, default=240)
parser.add_argument("--monitor-max-runtime", type=int, default=45)
parser.add_argument("--job-lock-path", default="/var/lib/multibagger/paper_jobs.lock")
parser.add_argument("--days", type=int, default=35)
parser.add_argument("--no-resume", action="store_true")
args = parser.parse_args()
settings = Settings.from_env()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    handlers=[
        logging.FileHandler("intraday_bot_log.txt"),
        logging.StreamHandler(sys.stdout)
    ]
)

# Start Telegram Remote Control Panel in daemon thread
telegram_ctrl = TelegramController(settings)
telegram_ctrl.start()

try:
    from scripts.telegram_notify import send_telegram_message
    from datetime import datetime
    import zoneinfo
    IST = zoneinfo.ZoneInfo("Asia/Kolkata")
    now_ist = datetime.now(IST)
    send_telegram_message(
        f"🟢 Upstox Intraday Paper Engine Started & Active\n"
        f"Time: {now_ist.strftime('%H:%M:%S IST')}\n"
        f"Status: Pure REST Market Quote Engine + Unified Model Active",
        event_key=f"engine-startup-{now_ist.strftime('%Y%m%d-%H%M%S')}",
        cooldown_seconds=0,
    )
except Exception as err:
    logging.warning("Telegram startup notification failed: %s", err)


def monitor_resources() -> None:
    """Logs RSS memory usage (MB) and CPU % every 5 minutes."""
    import os
    import time
    try:
        import psutil
        process = psutil.Process(os.getpid())
        while True:
            mem_mb = process.memory_info().rss / (1024 * 1024)
            cpu_pct = process.cpu_percent(interval=1.0)
            logging.info("Resource monitor: memory=%.1fMB, cpu=%.1f%%", mem_mb, cpu_pct)
            time.sleep(300)
    except Exception as err:
        logging.debug("Resource monitor unavailable: %s", err)


threading.Thread(target=monitor_resources, name="resource-monitor", daemon=True).start()


try:
    if args.command == "backfill":
        from engine.backfill import backfill
        print(json.dumps(backfill(settings, date.fromisoformat(args.start or "2022-01-01"),
                                  date.fromisoformat(args.end) if args.end else None,
                                  resume=not args.no_resume), indent=2))
    elif args.command == "upstox-warmup":
        from features.upstox.python.upstox_backfill import warmup_upstox
        print(json.dumps(warmup_upstox(settings, args.days), indent=2))
    elif args.command == "collect":
        collect(settings)
    elif args.command == "worker":
        run_worker(settings, args.scan_interval, args.monitor_interval, args.scan_max_runtime,
                   args.monitor_max_runtime, args.job_lock_path)
    elif args.command == "scan":
        print(json.dumps(run_scan(settings), indent=2))
    elif args.command == "monitor":
        from engine.paper import run_risk_monitor
        print(json.dumps(run_risk_monitor(settings), indent=2))
    elif args.command == "backtest":
        if not args.start or not args.end:
            parser.error("backtest requires --start and --end")
        from engine.backtest import walk_forward
        print(json.dumps(walk_forward(settings, args.start, args.end), indent=2))
    else:
        if not args.start or not args.end:
            parser.error("replay requires --start and --end")
        from engine.replay import replay_recorded_entries
        print(json.dumps(replay_recorded_entries(
            settings, date.fromisoformat(args.start), date.fromisoformat(args.end),
        ), indent=2))
finally:
    gc.collect()
