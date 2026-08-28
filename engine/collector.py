from __future__ import annotations

import logging
import fcntl
import os
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Settings
from .store import MarketStore
from .scanner import run_scan
from .paper import run_risk_monitor
from .strategies import active_agent
from .universe import build_daily_trading_universe
from scripts.telegram_notify import send_telegram_message


IST = ZoneInfo("Asia/Kolkata")
OPERATIONAL_SCAN_BLOCKERS = frozenset({
    "REGIME_INPUT_UNAVAILABLE",
    "DAILY_250_STOCK_UNIVERSE_UNAVAILABLE",
    "DATA_UNAVAILABLE",
})


def collect(settings: Settings, on_market_data=None) -> None:
    if settings.market_data_provider != "upstox":
        raise RuntimeError("Paper collection is Upstox-only; Breeze is isolated from scheduled execution")
    from features.upstox.python.upstox_collector import collect_upstox

    collect_upstox(settings, on_market_data=on_market_data)


def run_worker(settings: Settings, scan_interval: int = 900, monitor_interval: int = 30,
               scan_max_runtime: int = 240, monitor_max_runtime: int = 45,
               lock_path: str = "/var/lib/multibagger/paper_jobs.lock") -> None:
    """Collect continuously while aligned, locked jobs scan or monitor paper positions."""
    validate_scheduled_execution_identity(settings)
    if scan_interval != 900:
        raise ValueError("Upstox full scans must run every 900 seconds")
    if monitor_interval != 30:
        raise ValueError("risk monitor interval must be exactly 30 seconds")
    if not 30 <= scan_max_runtime < 300 or not 10 <= monitor_max_runtime <= 60:
        raise ValueError("invalid paper job runtime limit")
    store = MarketStore(settings.db_path)
    recovered = store.recover_incomplete_runs()
    if recovered:
        logging.warning("marked %d interrupted scanner runs as failed", recovered)
    removed = store.prune(35)
    if removed:
        logging.info("pruned %d minute bars older than 35 days", removed)
    # The worker starts before the open, but the spread filter must use current-session
    # quotes. Never stamp a new trading-day universe from the previous close.
    settings.active_universe_path.unlink(missing_ok=True)
    stop = threading.Event()
    last_event_monitor = 0.0
    send_telegram_message(
        "🟢 Upstox Intraday paper engine started\n"
        "Signal checks: every 15 minutes\n"
        "Closed-candle risk monitor: every 30 seconds\nMode: Upstox Sandbox (no real money)",
        event_key="upstox-worker-started", cooldown_seconds=3600,
    )

    def scanner_loop() -> None:
        completed_slots: set[str] = set()
        universe_day = None
        last_universe_attempt = 0.0
        last_hours_log = 0.0
        while not stop.wait(0.5):
            utc_now = datetime.now(timezone.utc)
            local = utc_now.astimezone(IST)
            minute = local.hour * 60 + local.minute
            current = time.monotonic()
            in_hours = (local.weekday() < 5 and 9 * 60 + 16 <= minute <= 15 * 60 + 20)

            if current - last_hours_log >= 300:
                logging.info("Market hours check: %s UTC, %s IST, market_open=%s",
                             utc_now.strftime("%H:%M:%S"), local.strftime("%H:%M:%S"), "PASS" if in_hours else "FAIL")
                last_hours_log = current

            if not in_hours:
                continue
            if minute >= 9 * 60 + 25 and universe_day != local.date() \
                    and current - last_universe_attempt >= 60:
                last_universe_attempt = current
                try:
                    logging.info("Universe selection starting...")
                    universe_result = build_daily_trading_universe(
                        settings, store, utc_now,
                    )
                    universe_day = local.date()
                    logging.info("daily live-spread universe selected=%d", len(universe_result))
                except Exception:
                    settings.active_universe_path.unlink(missing_ok=True)
                    logging.exception("daily live-spread universe failed; scans remain fail closed")
            slot = local.strftime("%Y%m%d-%H%M")
            job_type = scheduled_upstox_job(local, monitor_interval)
            max_runtime = scan_max_runtime if job_type == "FULL_SCAN" else monitor_max_runtime
            if not job_type or slot in completed_slots:
                continue
            completed_slots.add(slot)
            if len(completed_slots) > 600:
                completed_slots = {slot}
            logging.info("Scanner triggered at %s (IST) - job_type=%s, slot=%s", local.strftime("%H:%M:%S"), job_type, slot)
            _run_locked_job(store, settings, job_type, local, max_runtime, Path(lock_path))

    thread = threading.Thread(target=scanner_loop, name="paper-scheduler", daemon=True)
    thread.start()

    def event_driven_risk_monitor() -> None:
        nonlocal last_event_monitor
        if settings.execution_paused:
            return
        current = time.monotonic()
        local = datetime.now(timezone.utc).astimezone(IST)
        if store.has_open_trades():
            if current - last_event_monitor < settings.paper_monitor_interval_seconds:
                return
            last_event_monitor = current
            _run_locked_job(store, settings, "RISK_MONITOR", local, monitor_max_runtime, Path(lock_path))
        # Full-universe scans are handled by the aligned 15-minute scheduler.
        # Feed callbacks only run the cheap open-position monitor.

    from engine.degraded import DEGRADED_MANAGER

    while not stop.is_set():
        try:
            collect(settings, on_market_data=event_driven_risk_monitor)
            DEGRADED_MANAGER.report_recovery("WEBSOCKET")
            break
        except Exception as error:
            DEGRADED_MANAGER.report_failure("WEBSOCKET", f"Upstox paper worker feed error: {error}")
            delay = DEGRADED_MANAGER.compute_backoff(
                "WEBSOCKET",
                initial_delay=getattr(settings, "backoff_initial_seconds", 1.0),
                max_delay=getattr(settings, "backoff_max_seconds", 60.0),
            )
            logging.warning("Upstox worker collection error: %s; retrying in %.1fs (SAFE_DEGRADED mode active)", error, delay)
            time.sleep(delay)
    stop.set()
    thread.join(timeout=5)
    send_telegram_message(
        "⚪ Upstox Intraday paper engine stopped.",
        event_key="upstox-worker-stopped", cooldown_seconds=300,
    )


def scheduled_upstox_job(local: datetime, monitor_interval: int = 30) -> str | None:
    minute = local.hour * 60 + local.minute
    if local.weekday() >= 5 or not 9 * 60 + 16 <= minute <= 15 * 60 + 20:
        return None
    if 9 * 60 + 35 <= minute <= 14 * 60 + 50 and minute % 15 == 5:
        return "FULL_SCAN"
    if 9 * 60 + 28 <= minute <= 14 * 60 + 43 and minute % 15 == 13:
        return None
    if minute % 1 == 0:
        return "RISK_MONITOR"
    return None


def _run_locked_job(store: MarketStore, settings: Settings, job_type: str, scheduled_at: datetime,
                    max_runtime: int, lock_path: Path) -> dict | None:
    if job_type == "FULL_SCAN":
        validate_scheduled_execution_identity(settings, scheduled_at)
    job_id = str(uuid.uuid4())
    started = time.monotonic()
    with _nonblocking_lock(lock_path) as acquired:
        if not acquired:
            store.record_skipped_job(job_id, "UPSTOX_INTRADAY", job_type, scheduled_at,
                                     max_runtime, "SINGLE_JOB_LOCK_BUSY")
            logging.info("skipped %s because the shared paper-job lock is busy", job_type)
            if job_type == "FULL_SCAN":
                send_telegram_message(
                    "⚠️ Upstox Intraday full scan skipped\nReason: shared job lock was busy",
                    event_key="upstox-full-scan-lock-busy", cooldown_seconds=900,
                )
            return
        store.start_job(job_id, "UPSTOX_INTRADAY", job_type, scheduled_at, max_runtime)
        try:
            if job_type == "FULL_SCAN":
                result = run_scan(settings, deadline_monotonic=time.monotonic() + max_runtime)
            else:
                result = run_risk_monitor(settings)
            elapsed = int((time.monotonic() - started) * 1000)
            status = "COMPLETED" if elapsed <= max_runtime * 1000 else "MAX_RUNTIME_EXCEEDED"
            store.finish_job(job_id, status, elapsed, None if status == "COMPLETED" else "JOB_FINISHED_LATE")
            if status != "COMPLETED":
                send_telegram_message(
                    f"⚠️ Upstox Intraday {job_type.lower()} exceeded its runtime limit\nDuration: {elapsed / 1000:.1f}s",
                    event_key=f"upstox-{job_type.lower()}-late", cooldown_seconds=900,
                )
            elif job_type == "FULL_SCAN":
                send_telegram_message(
                    _upstox_scan_message(result, scheduled_at, elapsed),
                    event_key=f"upstox-scan-{scheduled_at.strftime('%Y%m%d-%H%M')}",
                )
                _notify_scan_blocker(result, scheduled_at)
            else:
                for trade in result.get("closedByMonitor", []):
                    send_telegram_message(
                        _upstox_exit_message(trade),
                        event_key=f"upstox-exit-{trade.get('trade_id')}",
                    )
            return result
        except TimeoutError as error:
            store.finish_job(job_id, "MAX_RUNTIME_EXCEEDED", int((time.monotonic() - started) * 1000), str(error)[:500])
            logging.error("%s exceeded its maximum runtime: %s", job_type, error)
            send_telegram_message(
                f"🔴 Upstox Intraday {job_type.lower()} timed out\nThe run was stopped and recorded as failed.",
                event_key=f"upstox-{job_type.lower()}-timeout", cooldown_seconds=900,
            )
        except Exception as error:
            store.finish_job(job_id, "FAILED", int((time.monotonic() - started) * 1000), str(error)[:500])
            logging.exception("paper %s failed", job_type.lower())
            send_telegram_message(
                f"🔴 Upstox Intraday {job_type.lower()} failed\nReason: {str(error)[:300]}",
                event_key=f"upstox-{job_type.lower()}-failed", cooldown_seconds=900,
            )


def validate_scheduled_execution_identity(settings: Settings,
                                           now: datetime | None = None) -> str:
    identity = active_agent(now or datetime.now(timezone.utc))
    if not identity or identity not in settings.enabled_agents:
        configured = ",".join(settings.enabled_agents) or "NONE"
        raise RuntimeError(
            f"Scheduled execution identity {identity or 'NONE'} is not enabled "
            f"(configured: {configured})"
        )
    return identity


def _upstox_scan_message(result: dict, scheduled_at: datetime, elapsed_ms: int) -> str:
    paper = result.get("paperTrading") or {}
    metrics = paper.get("dailyMetrics") or {}
    rejections = paper.get("entryRejections") or []
    return (
        "✅ Upstox Intraday full scan completed\n"
        f"Time: {scheduled_at.strftime('%H:%M IST')} | Duration: {elapsed_ms / 1000:.1f}s\n"
        f"Status: {result.get('status') or 'UNKNOWN'} | Reason: {result.get('reason') or 'NONE'}\n"
        f"Signals: {len(result.get('signals') or [])} | Open positions: {len(paper.get('openPositions') or [])} | Entry rejections: {len(rejections)}\n"
        f"Daily net P&L: ₹{float(metrics.get('netPnl') or 0):,.2f} / ₹{float(paper.get('dailyProfitTarget') or 0):,.2f}\n"
        f"Target reached: {'YES' if paper.get('targetReached') else 'NO'}"
    )


def _notify_scan_blocker(result: dict, scheduled_at: datetime) -> bool:
    reason = str(result.get("reason") or "")
    if reason not in OPERATIONAL_SCAN_BLOCKERS:
        return False
    descriptions = {
        "REGIME_INPUT_UNAVAILABLE": "required NIFTY 50, INDIA VIX, or market-breadth data is missing/stale",
        "DAILY_250_STOCK_UNIVERSE_UNAVAILABLE": "the daily executable trading universe is unavailable",
        "DATA_UNAVAILABLE": "the scan could not access required market data",
    }
    return send_telegram_message(
        "🔴 Upstox paper entries blocked — action required\n"
        f"Time: {scheduled_at.strftime('%H:%M IST')}\n"
        f"Reason: {reason}\n"
        f"Diagnosis: {descriptions[reason]}\n"
        "Trading remains fail-closed; the daily target cannot be pursued until this is resolved.",
        event_key=f"upstox-operational-blocker-{reason.lower()}",
        cooldown_seconds=1800,
    )


def _upstox_exit_message(trade: dict) -> str:
    return (
        "🔔 Upstox Intraday position closed\n"
        f"Symbol: {trade.get('symbol')} | Reason: {trade.get('exit_reason')}\n"
        f"Net P&L: ₹{float(trade.get('net_pnl') or 0):,.2f}\n"
        f"Mode: {trade.get('execution_mode')}"
    )


@contextmanager
def _nonblocking_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    acquired = False
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            pass
        yield acquired
    finally:
        if acquired:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)
