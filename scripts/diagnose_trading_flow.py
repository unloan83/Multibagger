#!/usr/bin/env python3
"""
Comprehensive Trading Flow Diagnostic Script

Audits the entire pipeline:
WebSocket Ingestion -> DuckDB Storage -> 15-Min Aligned Scanner -> Market Regime Gate -> Candidate Scoring -> Paper Trade Entry
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# Auto-add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from engine.config import Settings
from engine.store import MarketStore

IST = ZoneInfo("Asia/Kolkata")
LOG = logging.getLogger("multibagger.diagnose")


def main() -> int:
    settings = Settings.from_env()
    store = MarketStore(settings.db_path)
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST)

    print("==================================================")
    print("=== INTRADAY TRADING FLOW DIAGNOSTIC REPORT ===")
    print(f"Time: {now_utc.strftime('%H:%M:%S UTC')} | {now_ist.strftime('%H:%M:%S IST')} ({now_ist.strftime('%A')})")
    print("==================================================")

    # 1. Market Hours Check
    minute = now_ist.hour * 60 + now_ist.minute
    in_market_hours = (now_ist.weekday() < 5 and 9 * 60 + 16 <= minute <= 15 * 60 + 20)
    market_hours_status = "✅ PASS (Within 09:16 - 15:20 IST)" if in_market_hours else "⚠️ OFF-HOURS (Outside 09:16 - 15:20 IST)"
    print(f"Market Hours Check: {market_hours_status}")

    # 2. DuckDB Bar Ingestion Check
    bar_count = 0
    latest_bar_ts = None
    try:
        with store.connect() as con:
            bar_count = con.execute("SELECT count(*) FROM minute_bars").fetchone()[0]
            latest_row = con.execute("SELECT max(ts) FROM minute_bars").fetchone()
            if latest_row and latest_row[0]:
                latest_bar_ts = str(latest_row[0])
    except Exception as err:
        print(f"❌ DuckDB Storage Check: FAILED ({err})")

    if bar_count > 0:
        print(f"✅ DuckDB Storage: {bar_count:,} 1-min bars stored (Latest bar: {latest_bar_ts})")
    else:
        print("❌ DuckDB Storage: No 1-min bars found in database")

    # 3. Scanner Runs Check
    recent_runs = []
    last_run_time = None
    last_run_status = None
    last_run_reason = None
    try:
        with store.connect() as con:
            recent_runs = con.execute(
                "SELECT run_id, started_at, completed_at, status, universe_size, signal_count, reason FROM scanner_runs ORDER BY started_at DESC LIMIT 5"
            ).fetchall()
            if recent_runs:
                last_run_time = recent_runs[0][1]
                last_run_status = recent_runs[0][3]
                last_run_reason = recent_runs[0][6]
    except Exception as err:
        print(f"❌ Scanner Database Check: FAILED ({err})")

    if recent_runs:
        print(f"✅ Scanner Loop: Last run at {last_run_time} (Status: {last_run_status}, Reason: {last_run_reason or 'NONE'})")
    else:
        print("❌ Scanner Loop: No scanner runs recorded yet")

    # 4. Market Regime & Audit Log Check
    audit_count = 0
    latest_audit_regime = None
    try:
        with store.connect() as con:
            audit_count = con.execute("SELECT count(*) FROM intraday_audit_log").fetchone()[0]
            latest_audit = con.execute("SELECT regime, observed_at FROM intraday_audit_log ORDER BY observed_at DESC LIMIT 1").fetchone()
            if latest_audit:
                latest_audit_regime = latest_audit[0]
    except Exception as err:
        print(f"⚠️ Audit Log Check: FAILED ({err})")

    if audit_count > 0:
        print(f"✅ Regime & Candidate Audit: {audit_count:,} symbol audits recorded (Latest regime: {latest_audit_regime})")
    else:
        print("⚠️ Regime & Candidate Audit: No symbol audit entries recorded")

    # 5. Paper Signals & Trade Entries
    signal_count = 0
    open_positions = 0
    closed_trades_today = 0
    try:
        with store.connect() as con:
            signal_count = con.execute("SELECT count(*) FROM paper_signals").fetchone()[0]
            open_positions = con.execute("SELECT count(*) FROM paper_trades WHERE status='OPEN'").fetchone()[0]
            today_str = now_ist.strftime("%Y-%m-%d")
            closed_trades_today = con.execute(
                "SELECT count(*) FROM paper_trades WHERE status='CLOSED' AND strftime('%Y-%m-%d', closed_at)=?",
                [today_str],
            ).fetchone()[0]
    except Exception as err:
        print(f"⚠️ Trade Engine Check: FAILED ({err})")

    print(f"✅ Paper Signals Generated: {signal_count}")
    print(f"✅ Trade Engine: {open_positions} open positions, {closed_trades_today} closed trades today")

    # 6. Log File Check for Recent Activity
    log_file = Path("intraday_bot_log.txt")
    if log_file.exists():
        lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        last_log = lines[-1] if lines else "EMPTY"
        print(f"✅ Log File Activity: Active ({len(lines)} lines total)")
        print(f"   Latest Log: {last_log[:120]}")
    else:
        print("⚠️ Log File: intraday_bot_log.txt not found locally")

    # 7. Root Cause Summary
    print("\n--------------------------------------------------")
    print("=== ROOT CAUSE & PIPELINE DIAGNOSIS ===")
    if not in_market_hours:
        print("INFO: Scanner and trade entry triggers are currently PAUSED because NSE market is closed.")
        print("      NSE Trading Hours: Monday to Friday, 09:16 to 15:20 IST.")
        print("      The WebSocket and paper worker continue collecting live background feeds.")
    elif not recent_runs:
        print("ACTION REQUIRED: No scanner runs detected. Check job lock or worker thread initialization.")
    elif last_run_reason in ("REGIME_INPUT_UNAVAILABLE", "DAILY_250_STOCK_UNIVERSE_UNAVAILABLE"):
        print(f"ACTION REQUIRED: Scans are fail-closed due to: {last_run_reason}.")
    else:
        print("PIPELINE HEALTHY: End-to-end execution path is active and operating as configured.")
    print("--------------------------------------------------")

    return 0


if __name__ == "__main__":
    sys.exit(main())
