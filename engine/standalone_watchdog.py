from __future__ import annotations

import datetime
import json
import logging
import sys
import time
from pathlib import Path
from engine.notifier import send_telegram_alert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] watchdog: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("standalone_watchdog")

def monitor_heartbeats(heartbeat_file: str = "data/heartbeats.json", check_interval: float = 10.0):
    logger.info("Standalone Watchdog Supervisor started. Monitoring %s...", heartbeat_file)
    hb_path = Path(heartbeat_file)
    
    thresholds = {
        "engine": 30.0,
        "market_data": 30.0,
        "universe_scanner": 90.0,
        "position_manager": 30.0,
    }

    while True:
        try:
            if hb_path.exists():
                with open(hb_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
                stale = []
                for comp, limit_sec in thresholds.items():
                    last_ts = data.get(comp)
                    if last_ts is None or (now_ts - last_ts) > limit_sec:
                        stale.append(comp)

                if stale:
                    msg = f"🚨 <b>WATCHDOG_HEARTBEAT_LOSS</b>: Heartbeat lost for [{', '.join(stale)}]. Process may be dead."
                    logger.critical(msg)
                    send_telegram_alert(msg)
            time.sleep(check_interval)
        except Exception as e:
            logger.error("Error in watchdog loop: %s", e)
            time.sleep(check_interval)

if __name__ == "__main__":
    monitor_heartbeats()
