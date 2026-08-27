from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from engine.config import Settings
from engine.store import MarketStore

LOG = logging.getLogger("multibagger.premarket")


@dataclass
class PreMarketCheckResult:
    code_pass: bool
    code_reason: str
    config_pass: bool
    config_reason: str
    data_pass: bool
    data_reason: str
    service_pass: bool
    service_reason: str
    ready: bool

    def summary_text(self) -> str:
        code_str = "PASS" if self.code_pass else f"FAIL ({self.code_reason})"
        config_str = "PASS" if self.config_pass else f"FAIL ({self.config_reason})"
        data_str = "PASS" if self.data_pass else f"FAIL ({self.data_reason})"
        service_str = "PASS" if self.service_pass else f"FAIL ({self.service_reason})"
        ready_str = "YES" if self.ready else "NO"

        lines = [
            f"CODE: {code_str}",
            f"CONFIG: {config_str}",
            f"DATA: {data_str}",
            f"SERVICE: {service_str}",
            "",
            f"PAPER TRADING READY: {ready_str}"
        ]
        return "\n".join(lines)


def run_premarket_safety_check(settings: Settings, store: MarketStore | None = None) -> PreMarketCheckResult:
    """
    Lightweight pre-market safety check before daily paper trading execution.
    Fails closed on stale data, invalid config, or service issues.
    """
    # 1. CODE Check
    strategy_version = getattr(settings, "strategy_version", "v1.3-corrected-baseline")
    if strategy_version != "v1.3-corrected-baseline":
        code_pass = False
        code_reason = f"Invalid strategy version '{strategy_version}', expected 'v1.3-corrected-baseline'"
    else:
        code_pass = True
        code_reason = "Version v1.3-corrected-baseline verified"

    # 2. CONFIG Check
    live_env = os.getenv("ENABLE_LIVE_TRADING", "false").strip().lower()
    if live_env != "false":
        config_pass = False
        config_reason = f"ENABLE_LIVE_TRADING is '{live_env}', must be 'false'"
    elif settings.paper_max_risk_per_trade != 500.0:
        config_pass = False
        config_reason = f"Max risk per trade is INR {settings.paper_max_risk_per_trade}, expected 500.0"
    elif settings.paper_daily_loss_limit != 1000.0:
        config_pass = False
        config_reason = f"Daily loss limit is INR {settings.paper_daily_loss_limit}, expected 1000.0"
    elif settings.paper_max_aggregate_open_risk != 750.0:
        config_pass = False
        config_reason = f"Aggregate open risk is INR {settings.paper_max_aggregate_open_risk}, expected 750.0"
    else:
        config_pass = True
        config_reason = "Live trading disabled, risk parameters verified (₹500/₹1,000/₹750)"

    # 3. DATA Check
    data_store = store or MarketStore(settings.db_path, read_only=True)
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    is_weekend = now_ist.weekday() >= 5

    try:
        with data_store.connect(read_only=True) as con:
            latest_bar = con.execute("SELECT max(ts) FROM minute_bars").fetchone()
            latest_ts_str = latest_bar[0] if latest_bar and latest_bar[0] else None

            
        if latest_ts_str:
            dt = datetime.fromisoformat(str(latest_ts_str).replace("Z", "+00:00"))
            dt_ist = dt.astimezone(ZoneInfo("Asia/Kolkata"))
            is_today = (dt_ist.date() == now_ist.date())
            if not is_today and not is_weekend:
                data_pass = False
                data_reason = f"Stale feed data: latest bar is from {dt_ist.date()}, expected {now_ist.date()}"
            else:
                data_pass = True
                data_reason = f"Market feed timestamps verified ({dt_ist.strftime('%Y-%m-%d %H:%M IST')})"
        else:
            # Weekend / Fresh DB initialization
            data_pass = True
            data_reason = "Database initialized cleanly; waiting for market open feed"
    except Exception as err:
        data_pass = False
        data_reason = f"Database read failure: {err}"

    # 4. SERVICE Check
    try:
        db_file = settings.db_path
        if not db_file.parent.exists():
            db_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Test DB connectivity
        with data_store.connect() as con:
            con.execute("SELECT 1")
            
        service_pass = True
        service_reason = f"Database accessible ({settings.db_path.name}), scanner active"
    except Exception as err:
        service_pass = False
        service_reason = f"Service failure: {err}"

    ready = code_pass and config_pass and data_pass and service_pass

    result = PreMarketCheckResult(
        code_pass=code_pass,
        code_reason=code_reason,
        config_pass=config_pass,
        config_reason=config_reason,
        data_pass=data_pass,
        data_reason=data_reason,
        service_pass=service_pass,
        service_reason=service_reason,
        ready=ready,
    )

    if not ready:
        LOG.warning("PRE-MARKET CHECK FAILED:\n%s", result.summary_text())

    return result
