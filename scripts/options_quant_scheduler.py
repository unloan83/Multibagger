#!/usr/bin/env python3
"""Run one locked Options Quant scan or lightweight active-position monitor."""

from __future__ import annotations

import fcntl
import json
import os
import sqlite3
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

try:
    from scripts.telegram_notify import send_telegram_message
except ModuleNotFoundError:  # Direct systemd execution adds /opt/multibagger/scripts to sys.path.
    from telegram_notify import send_telegram_message


def main() -> int:
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    job_type = scheduled_options_job(now, sys.argv[1:])
    if job_type is None:
        return 0
    full_scan = job_type == "FULL_SCAN"
    endpoint = os.environ.get(
        "OPTIONS_QUANT_SCAN_URL" if full_scan else "OPTIONS_QUANT_MONITOR_URL",
        "https://unloanstockview.vercel.app/api/options-quant/scan" if full_scan
        else "https://unloanstockview.vercel.app/api/options-quant/monitor",
    ).strip()
    token = os.environ.get("OPTIONS_QUANT_INGEST_TOKEN", "").strip()
    if not token:
        print("OPTIONS_QUANT_INGEST_TOKEN is missing; refusing scheduled cycle.", file=sys.stderr)
        send_telegram_message(
            "🔴 Options Quant scheduler failed\nReason: ingest token is missing",
            event_key="options-ingest-token-missing", cooldown_seconds=3600,
        )
        return 1

    history_path = Path(os.environ.get("PAPER_SCHEDULER_HISTORY_DB", "/var/lib/multibagger/paper_scheduler_history.sqlite3"))
    lock_path = Path(os.environ.get("PAPER_JOB_LOCK_PATH", "/var/lib/multibagger/paper_jobs.lock"))
    job_id = str(uuid.uuid4())
    history_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(history_path) as history:
        ensure_schema(history)
        lock_handle = lock_path.open("a+")
        try:
            try:
                fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                record(history, job_id, job_type, now, "SKIPPED", 0, "SINGLE_JOB_LOCK_BUSY", None)
                print(json.dumps({"jobType": job_type, "status": "SKIPPED", "reason": "SINGLE_JOB_LOCK_BUSY"}, separators=(",", ":")))
                if job_type == "FULL_SCAN":
                    send_telegram_message(
                        "⚠️ Options Quant full scan skipped\nReason: shared job lock was busy",
                        event_key="options-full-scan-lock-busy", cooldown_seconds=900,
                    )
                return 0
            return invoke(history, job_id, job_type, now, endpoint, token)
        finally:
            try:
                fcntl.flock(lock_handle, fcntl.LOCK_UN)
            except OSError:
                pass
            lock_handle.close()


def invoke(history: sqlite3.Connection, job_id: str, job_type: str, scheduled_at: datetime,
           endpoint: str, token: str) -> int:
    started = time.monotonic()
    previous = latest_completed_summary(history)
    timeout_seconds = 50 if job_type == "FULL_SCAN" else 25
    request = Request(endpoint, data=b"{}", method="POST", headers={
        "Accept": "application/json", "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.load(response)
        if payload.get("ok") is not True:
            raise RuntimeError(str(payload.get("error") or "Options Quant rejected the job"))
    except HTTPError as error:
        detail = error.read(1000).decode("utf-8", errors="replace")
        duration = int((time.monotonic() - started) * 1000)
        record(history, job_id, job_type, scheduled_at, "FAILED", duration, f"HTTP_{error.code}: {detail}"[:1000], None)
        print(f"Options Quant HTTP {error.code}: {detail}", file=sys.stderr)
        send_telegram_message(
            f"🔴 Options Quant {job_type.lower()} failed\nHTTP status: {error.code}",
            event_key=f"options-{job_type.lower()}-failed", cooldown_seconds=900,
        )
        return 1
    except (URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
        duration = int((time.monotonic() - started) * 1000)
        status = "MAX_RUNTIME_EXCEEDED" if isinstance(error, TimeoutError) else "FAILED"
        record(history, job_id, job_type, scheduled_at, status, duration, str(error)[:1000], None)
        print(f"Options Quant {job_type.lower()} failed: {error}", file=sys.stderr)
        send_telegram_message(
            f"🔴 Options Quant {job_type.lower()} {status.lower().replace('_', ' ')}",
            event_key=f"options-{job_type.lower()}-{status.lower()}", cooldown_seconds=900,
        )
        return 1

    state = payload.get("state") or {}
    positions = state.get("positions") or []
    open_positions = sum(1 for position in positions if position.get("status") == "OPEN")
    daily_target = (state.get("configuration") or {}).get("dailyProfitTargetRupees")
    trading_day = scheduled_at.date()
    daily_net_pnl = sum(
        float(position.get("netPnl") or 0)
        for position in positions
        if position.get("status") == "CLOSED" and _ist_date(position.get("closedAt")) == trading_day
    )
    summary = {
        "asOf": state.get("asOf"), "stage": state.get("stage"),
        "direction": (state.get("direction") or {}).get("direction"),
        "openPositions": open_positions, "noTradeReasons": state.get("noTradeReasons") or [],
        "metrics": state.get("metrics") or {},
        "dailyProfitTarget": daily_target, "dailyNetPnl": round(daily_net_pnl, 2),
        "targetReached": bool(isinstance(daily_target, (int, float)) and daily_net_pnl >= daily_target),
    }
    duration = int((time.monotonic() - started) * 1000)
    record(history, job_id, job_type, scheduled_at, "COMPLETED", duration, None, summary)
    notify_completed(job_type, scheduled_at, duration, summary, previous)
    print(json.dumps({"jobType": job_type, "status": "COMPLETED", **summary}, separators=(",", ":")))
    return 0


def scheduled_options_job(now: datetime, arguments: list[str] | None = None) -> str | None:
    arguments = arguments or []
    if "--force-scan" in arguments:
        return "FULL_SCAN"
    if "--force" in arguments or "--force-monitor" in arguments:
        return "RISK_MONITOR"
    minute = now.hour * 60 + now.minute
    if now.weekday() >= 5 or minute < 9 * 60 + 15 or minute > 15 * 60 + 25:
        return None
    if 9 * 60 + 43 <= minute <= 14 * 60 + 43 and minute % 15 == 13:
        return "FULL_SCAN"
    if 9 * 60 + 20 <= minute <= 14 * 60 + 35 and minute % 15 == 5:
        return None
    return "RISK_MONITOR"


def _ist_date(value: object):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Kolkata")).date()
    except ValueError:
        return None


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute("""
      CREATE TABLE IF NOT EXISTS options_job_history (
        job_id TEXT PRIMARY KEY, model TEXT NOT NULL, job_type TEXT NOT NULL,
        scheduled_at TEXT NOT NULL, completed_at TEXT NOT NULL, status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL, reason TEXT, state_as_of TEXT, stage TEXT,
        direction TEXT, open_positions INTEGER, net_pnl REAL, target_reached INTEGER,
        summary_json TEXT
      )
    """)


def record(connection: sqlite3.Connection, job_id: str, job_type: str, scheduled_at: datetime,
           status: str, duration_ms: int, reason: str | None, summary: dict | None) -> None:
    metrics = (summary or {}).get("metrics") or {}
    net_pnl = (summary or {}).get("dailyNetPnl")
    target_reached = bool((summary or {}).get("targetReached"))
    connection.execute("""
      INSERT INTO options_job_history VALUES (?, 'OPTIONS_QUANT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        job_id, job_type, scheduled_at.isoformat(), datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
        status, duration_ms, reason, (summary or {}).get("asOf"), (summary or {}).get("stage"),
        (summary or {}).get("direction"), (summary or {}).get("openPositions"), net_pnl,
        int(target_reached), json.dumps(summary or {}, separators=(",", ":")),
    ])
    connection.commit()


def latest_completed_summary(connection: sqlite3.Connection) -> dict | None:
    row = connection.execute("""
      SELECT summary_json FROM options_job_history
      WHERE status='COMPLETED' ORDER BY completed_at DESC LIMIT 1
    """).fetchone()
    if not row or not row[0]:
        return None
    try:
        return json.loads(row[0])
    except json.JSONDecodeError:
        return None


def notify_completed(job_type: str, scheduled_at: datetime, duration_ms: int,
                     summary: dict, previous: dict | None) -> None:
    if job_type == "FULL_SCAN":
        send_telegram_message(
            "✅ Options Quant full scan completed\n"
            f"Time: {scheduled_at.strftime('%H:%M IST')} | Duration: {duration_ms / 1000:.1f}s\n"
            f"Direction: {summary.get('direction') or 'NO TRADE'} | Open positions: {summary.get('openPositions') or 0}\n"
            f"Daily net P&L: ₹{float(summary.get('dailyNetPnl') or 0):,.2f} / ₹{float(summary.get('dailyProfitTarget') or 0):,.2f}\n"
            f"Target reached: {'YES' if summary.get('targetReached') else 'NO'}",
            event_key=f"options-scan-{scheduled_at.strftime('%Y%m%d-%H%M')}",
        )
        return

    if previous is None:
        return
    old_open = int(previous.get("openPositions") or 0)
    new_open = int(summary.get("openPositions") or 0)
    target_just_reached = bool(summary.get("targetReached")) and not bool(previous.get("targetReached"))
    if new_open != old_open or target_just_reached:
        send_telegram_message(
            "🔔 Options Quant position status changed\n"
            f"Open positions: {old_open} → {new_open}\n"
            f"Daily net P&L: ₹{float(summary.get('dailyNetPnl') or 0):,.2f}\n"
            f"Target reached: {'YES' if summary.get('targetReached') else 'NO'}",
            event_key=f"options-position-change-{scheduled_at.strftime('%Y%m%d-%H%M')}",
        )


if __name__ == "__main__":
    raise SystemExit(main())
