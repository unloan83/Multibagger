from __future__ import annotations

import datetime
import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Tuple
from engine.notifier import send_telegram_alert

logger = logging.getLogger("watchdog")

class HeartbeatWatchdog:
    def __init__(self, filepath: str = "data/heartbeats.json"):
        self.filepath = Path(filepath)
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
        self.thresholds = {
            "engine": 30.0,
            "market_data": 30.0,
            "universe_scanner": 90.0,
            "position_manager": 30.0,
            "broker_reconciliation": 3600.0,
            "universe_scan": 90.0,
        }

    def update_heartbeat(self, component: str):
        now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
        data = self._read_data()
        data[component] = now_ts
        self._write_data(data)

    def _read_data(self) -> Dict[str, float]:
        if self.filepath.exists():
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _write_data(self, data: Dict[str, float]):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception as e:
            logger.warning("Failed to write heartbeat JSON: %s", e)

    def check_heartbeats(self) -> Tuple[bool, List[str]]:
        now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
        data = self._read_data()
        stale_components = []

        for component, limit_sec in self.thresholds.items():
            last_ts = data.get(component)
            if last_ts is None or (now_ts - last_ts) > limit_sec:
                stale_components.append(component)

        if stale_components:
            msg = f"⚠️ <b>WATCHDOG_HEARTBEAT_LOSS</b>: Critical component heartbeats missing/stale: {', '.join(stale_components)}"
            logger.error(msg)
            send_telegram_alert(msg)
            return False, stale_components

        return True, []
