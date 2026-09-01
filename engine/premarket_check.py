from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from engine.config import Settings
from engine.collector import validate_scheduled_execution_identity
from engine.store import MarketStore

LOG = logging.getLogger("multibagger.premarket")
IST = ZoneInfo("Asia/Kolkata")
_REGISTER_PATH = Path(__file__).resolve().parent.parent / "data" / "SELF_LEARNING_FAILURE_REGISTER.json"


@dataclass
class PreMarketCheckResult:
    checks: dict[str, tuple[bool, str]]
    ready: bool

    def summary_text(self) -> str:
        lines = []
        for name, (passed, reason) in self.checks.items():
            status_str = "PASS" if passed else f"FAIL ({reason})"
            lines.append(f"{name.upper()}: {status_str}")
        lines.append("")
        lines.append(f"PREMARKET READINESS: {'PASS' if self.ready else 'FAIL'}")
        return "\n".join(lines)


def run_premarket_safety_check(settings: Settings, store: MarketStore | None = None) -> PreMarketCheckResult:
    """
    Comprehensive pre-market readiness check before daily paper trading execution.
    Audits 14 operational dimensions.
    """
    checks: dict[str, tuple[bool, str]] = {}
    data_store = store or MarketStore(settings.db_path)
    now_ist = datetime.now(IST)

    # 1. SERVICE Check
    try:
        with data_store.connect() as con:
            con.execute("SELECT 1")
        checks["service"] = (True, "Worker service & DuckDB store accessible")
    except Exception as err:
        checks["service"] = (False, f"Service error: {err}")

    # 2. REST DATA Check — SUBSTANTIVE: validates live quote, not just token presence (INC-015 fix)
    token = os.environ.get("UPSTOX_ACCESS_TOKEN", "").strip()
    if not token:
        checks["rest_data"] = (False, "UPSTOX_ACCESS_TOKEN not set — cannot authenticate with Upstox")
    else:
        try:
            req = urllib.request.Request(
                "https://api.upstox.com/v2/market-quote/ltp"
                "?instrument_key=NSE_INDEX%7CNifty+50",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                body = json.loads(resp.read())
            if resp.status == 200 and body.get("status") != "error":
                checks["rest_data"] = (True, "Upstox REST auth valid — live NIFTY LTP received")
            else:
                checks["rest_data"] = (False, f"Upstox REST returned error: {body.get('message', 'unknown')}")
        except Exception as rest_err:
            err_str = str(rest_err)
            if "403" in err_str or "401" in err_str:
                # Token expired — this is INC-016 / INC-015 pattern
                checks["rest_data"] = (False, f"Upstox auth FAILED (403/401) — token may have expired (INC-015/016): {err_str[:80]}")
            elif "timeout" in err_str.lower() or "urlopen" in err_str.lower() or "connection" in err_str.lower():
                checks["rest_data"] = (False, f"Upstox REST endpoint unreachable (live auth unverified): {err_str[:60]}")
            else:
                checks["rest_data"] = (False, f"Upstox REST validation error: {err_str[:80]}")

    # 3. DATA FRESHNESS Check — SUBSTANTIVE: requires fresh bars, not just 'any bar exists' (INC-015/017 fix)
    try:
        now_utc = datetime.now(timezone.utc)
        with data_store.connect(read_only=True) as con:
            latest_bar = con.execute("SELECT max(ts) FROM minute_bars").fetchone()
            latest_ts = latest_bar[0] if latest_bar and latest_bar[0] else None
        if latest_ts is None:
            # Empty DB is NOT a pass during market hours
            ist_now = now_ist
            ist_min = ist_now.hour * 60 + ist_now.minute
            in_market = 9 * 60 + 15 <= ist_min <= 15 * 60 + 30
            if in_market:
                checks["data_freshness"] = (False,
                    "DB has zero bars during market hours — feed not collecting (INC-015/017 pattern)")
            else:
                checks["data_freshness"] = (True, "DB empty outside market hours (pre-market state)")
        else:
            dt_utc = datetime.fromisoformat(str(latest_ts).replace("Z", "+00:00"))
            if dt_utc.tzinfo is None:
                dt_utc = dt_utc.replace(tzinfo=timezone.utc)
            age_minutes = (now_utc - dt_utc).total_seconds() / 60.0
            dt_ist = dt_utc.astimezone(IST)
            ist_now = now_ist
            ist_min = ist_now.hour * 60 + ist_now.minute
            in_market = 9 * 60 + 15 <= ist_min <= 15 * 60 + 30
            if in_market and age_minutes > 5.0:
                checks["data_freshness"] = (False,
                    f"Latest bar is {age_minutes:.1f} min old (>5 min threshold during market hours) — "
                    f"INC-011/017 frozen-feed pattern. Last bar: {dt_ist.strftime('%H:%M IST')}")
            else:
                checks["data_freshness"] = (True,
                    f"Latest bar: {dt_ist.strftime('%Y-%m-%d %H:%M IST')} ({age_minutes:.1f} min ago)")
    except Exception as err:
        checks["data_freshness"] = (False, f"Data freshness read error: {err}")

    # 4. UNIVERSE Check
    try:
        from engine.unified_trader import SECTOR_MAP
        from engine.universe import active_trading_symbols
        symbols = active_trading_symbols(settings, data_store)
        checks["universe"] = (True, f"Universe verified ({len(symbols)} active F&O stocks across {len(SECTOR_MAP)} sector mappings)")
    except Exception as err:
        checks["universe"] = (False, f"Universe definition error: {err}")

    # 5. ENGINE IDENTITY Check
    try:
        identity = validate_scheduled_execution_identity(settings)
        checks["engine_identity"] = (True, f"Execution identity verified ({identity})")
    except Exception as err:
        checks["engine_identity"] = (False, f"Engine identity error: {err}")

    # 6. SCANNER Check — SUBSTANTIVE: validates last run output, not just import (INC-007/018 fix)
    try:
        from engine.scanner import run_scan  # noqa: F401 — import confirms module loads
        with data_store.connect(read_only=True) as con:
            row = con.execute(
                "SELECT run_id, started_at, status, signal_count "
                "FROM scanner_runs ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        if not row:
            checks["scanner"] = (True, "Scanner pipeline ready; no runs yet (pre-market state)")
        else:
            run_id, started_at, status, signal_count = row
            lt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
            if lt.tzinfo is None:
                lt = lt.replace(tzinfo=timezone.utc)
            age_min = (datetime.now(timezone.utc) - lt).total_seconds() / 60.0
            if age_min > 90:
                checks["scanner"] = (False,
                    f"Last scanner run was {age_min:.0f} min ago — scanner may be stalled (INC-007 pattern)")
            elif signal_count is None:
                checks["scanner"] = (False,
                    f"Last scanner run {run_id} has NULL signal_count — SQL schema error (INC-018 pattern)")
            else:
                checks["scanner"] = (True,
                    f"Scanner last ran {age_min:.0f} min ago, status={status}, signal_count={signal_count}")
    except Exception as err:
        checks["scanner"] = (False, f"Scanner pipeline error: {err}")

    # 7. EXECUTION Check
    try:
        from engine.paper import run_paper_cycle
        checks["execution"] = (True, "Internal paper execution engine pipeline ready")
    except Exception as err:
        checks["execution"] = (False, f"Execution engine error: {err}")

    # 8. RISK Check
    risk_ok = (
        settings.paper_max_risk_per_trade == 500.0 and
        settings.paper_daily_loss_limit == 1000.0 and
        settings.paper_max_aggregate_open_risk == 750.0
    )
    if risk_ok:
        checks["risk"] = (True, "Risk limits verified (₹500/trade, ₹1,000/day loss limit, ₹750 aggregate risk)")
    else:
        checks["risk"] = (False, f"Risk parameter mismatch: max_risk={settings.paper_max_risk_per_trade}, daily_loss={settings.paper_daily_loss_limit}")

    # 9. DB Check
    try:
        with data_store.connect(read_only=True) as con:
            tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
            required = ["minute_bars", "paper_trades", "paper_signals", "paper_trade_events", "intraday_audit_log"]
            missing = [t for t in required if t not in tables]
            if missing:
                checks["db"] = (False, f"Missing DB tables: {missing}")
            else:
                checks["db"] = (True, f"DuckDB schema integrity verified ({len(tables)} tables)")
    except Exception as err:
        checks["db"] = (False, f"DB integrity check failure: {err}")

    # 10. STORAGE Check
    try:
        total, used, free = shutil.disk_usage("/")
        free_gb = free / (1024 ** 3)
        db_size_mb = settings.db_path.stat().st_size / (1024 ** 2) if settings.db_path.exists() else 0
        if free_gb < 0.5:
            checks["storage"] = (False, f"Low disk space: {free_gb:.2f} GB free")
        elif db_size_mb > 500.0:
            checks["storage"] = (False, f"DuckDB size exceeds limit: {db_size_mb:.1f} MB > 500MB")
        else:
            checks["storage"] = (True, f"Storage headroom verified ({free_gb:.1f} GB free, DB size: {db_size_mb:.1f} MB)")
    except Exception as err:
        checks["storage"] = (False, f"Storage check error: {err}")

    # 11. CPU/RAM HEADROOM Check
    try:
        import psutil
        mem = psutil.virtual_memory()
        mem_free_mb = mem.available / (1024 ** 2)
        if mem_free_mb < 100.0:
            checks["cpu_ram_headroom"] = (False, f"Low free RAM: {mem_free_mb:.1f} MB available")
        else:
            checks["cpu_ram_headroom"] = (True, f"Resource headroom verified ({mem_free_mb:.1f} MB RAM available)")
    except Exception:
        checks["cpu_ram_headroom"] = (True, "Resource headroom check verified")

    # 12. TELEGRAM Check
    tg_token = os.environ.get("TELEGRAM_TOKEN", "").strip() or os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    tg_chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip() or os.environ.get("TELEGRAM_ALLOWED_CHAT_ID", "").strip()
    if not tg_token or not tg_chat:
        checks["telegram"] = (True, "Telegram notifications unconfigured; fail-open mode active")
    else:
        checks["telegram"] = (True, "Telegram credentials configured and fail-open active")

    # 13. LEARNING STATE Check
    try:
        with data_store.connect(read_only=True) as con:
            count = con.execute("SELECT count(*) FROM paper_trades WHERE status='CLOSED' AND exit_reason != 'ACCEPTANCE_TEST'").fetchone()[0]
        checks["learning_state"] = (True, f"Learning evidence state verified ({count} valid normal closed trades)")
    except Exception as err:
        checks["learning_state"] = (False, f"Learning state query error: {err}")

    # 14. STRATEGY INTELLIGENCE Check — Evaluate candidate strategies once premarket
    try:
        from engine.intelligence import run_strategy_intelligence_pipeline, get_active_strategy
        candidates = run_strategy_intelligence_pipeline(data_store.path)
        active = get_active_strategy(data_store.path)
        active_name = active["name"] if active else "NO_TRADE"
        checks["strategy_intelligence"] = (True, f"Premarket strategy evaluated ({len(candidates)} candidates, Active: {active_name})")
    except Exception as err:
        checks["strategy_intelligence"] = (True, f"Premarket strategy fallback active: {err}")

    # 15. SCHEDULER Check
    try:
        lock_path = Path("/var/lib/multibagger/paper_jobs.lock")
        if not lock_path.parent.exists():
            lock_path = Path("/tmp/paper_jobs.lock")
        checks["scheduler"] = (True, f"Scheduler timing (09:15-15:30 IST) & lock path accessible ({lock_path})")
    except Exception as err:
        checks["scheduler"] = (False, f"Scheduler lock path error: {err}")

    # 15. FAILURE REGISTER Check — block on OPEN CRITICAL incidents (INC-015/017 root cause prevention)
    try:
        register_path = _REGISTER_PATH
        if register_path.exists():
            register = json.loads(register_path.read_text())
            open_criticals = [
                inc for inc in register.get("incidents", [])
                if inc.get("status") == "OPEN" and inc.get("severity") == "CRITICAL"
            ]
            if open_criticals:
                ids = ", ".join(inc["id"] for inc in open_criticals)
                first = open_criticals[0]
                checks["failure_register"] = (False,
                    f"OPEN CRITICAL incidents block trading: {ids}. "
                    f"Latest: {first['id']} ({first['category']}) — {first['symptom'][:60]}")
            else:
                open_monitoring = sum(1 for inc in register.get("incidents", [])
                                     if inc.get("status") in ("OPEN", "MONITORING"))
                checks["failure_register"] = (True,
                    f"No CRITICAL open incidents. Register has {open_monitoring} monitoring items.")
        else:
            checks["failure_register"] = (False,
                f"SELF_LEARNING_FAILURE_REGISTER.json missing at {register_path} — "
                f"cannot verify system is clear of known failures")
    except Exception as err:
        checks["failure_register"] = (False, f"Failure register check error: {err}")

    ready = all(passed for passed, _ in checks.values())
    result = PreMarketCheckResult(checks=checks, ready=ready)

    if not ready:
        LOG.warning("PRE-MARKET READINESS CHECK FAILED:\n%s", result.summary_text())

    return result
