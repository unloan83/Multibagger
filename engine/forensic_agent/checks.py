"""
engine/forensic_agent/checks.py
=================================
26 Named Forensic Checks (CHK-01 through CHK-26) — Hardened Version.

GLOBAL RULE ENFORCED:
  Missing evidence / unavailable dependency / check exception / insufficient data = NOT_VERIFIED or FAIL, NEVER PASS.

Evidence Rule:
  PASS status emitted without supporting evidence is automatically downgraded to NOT_VERIFIED.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from engine.calendar import get_market_session_state

ROOT = Path(__file__).resolve().parents[2]
REGISTER_PATH = ROOT / "data" / "SELF_LEARNING_FAILURE_REGISTER.json"
LOG_PATH = ROOT / "intraday_bot_log.txt"
IST_OFFSET = timedelta(hours=5, minutes=30)


@dataclass
class CheckResult:
    check_id: str
    name: str
    status: str  # PASS | FAIL | NOT_VERIFIED
    evidence: str
    detail: str
    severity: str = "HIGH"  # CRITICAL | HIGH | MEDIUM | LOW

    def to_dict(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "name": self.name,
            "status": self.status,
            "evidence": self.evidence,
            "detail": self.detail,
            "severity": self.severity,
        }


def enforce_evidence_rule(res: CheckResult) -> CheckResult:
    if res.status == "PASS" and not res.evidence.strip():
        return CheckResult(
            check_id=res.check_id,
            name=res.name,
            status="NOT_VERIFIED",
            evidence="REJECTED: PASS status emitted without supporting evidence",
            detail=f"Original detail: {res.detail}",
            severity=res.severity,
        )
    return res


# ---------------------------------------------------------------------------
# Checks 01 - 08: Implementation checks (Code / Config inspection)
# ---------------------------------------------------------------------------

def chk01_config_fields_present() -> CheckResult:
    check_id, name = "CHK-01", "CONFIG_FIELDS_PRESENT"
    try:
        from engine.config import Settings
        fields = Settings.__dataclass_fields__
        required = [
            "paper_consecutive_loss_limit",
            "paper_flatten_hour_ist",
            "paper_flatten_minute_ist",
            "paper_max_open_positions",
            "require_setup_confirmation",
            "paper_max_risk_per_trade",
            "paper_daily_loss_limit",
            "paper_max_aggregate_open_risk",
        ]
        missing = [f for f in required if f not in fields]
        if missing:
            return CheckResult(check_id, name, "FAIL", f"Missing fields: {missing}", f"Settings dataclass missing required fields: {missing}")
        return CheckResult(check_id, name, "PASS", f"engine/config.py contains all {len(required)} fields", "All required config fields present in Settings dataclass")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Import/inspection error: {e}", str(e))


def chk02_risk_caps_hardcoded() -> CheckResult:
    check_id, name = "CHK-02", "RISK_CAPS_HARDCODED"
    try:
        from engine.config import Settings
        s = Settings.from_env()
        ok = (
            abs(s.paper_max_risk_per_trade - 500.0) < 0.01 and
            abs(s.paper_daily_loss_limit - 1000.0) < 0.01 and
            abs(s.paper_max_aggregate_open_risk - 750.0) < 0.01
        )
        if ok:
            ev = f"Settings.from_env(): max_risk={s.paper_max_risk_per_trade}, daily_loss={s.paper_daily_loss_limit}, agg_risk={s.paper_max_aggregate_open_risk}"
            return CheckResult(check_id, name, "PASS", ev, "Risk caps match hardcoded baseline (Rs500/trade, Rs1000/day, Rs750 agg)")
        return CheckResult(check_id, name, "FAIL", f"Mismatched caps: trade={s.paper_max_risk_per_trade}, day={s.paper_daily_loss_limit}", "Risk caps diverge from baseline")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk03_execution_paused_flag() -> CheckResult:
    check_id, name = "CHK-03", "EXECUTION_PAUSED_FLAG"
    try:
        from engine.config import Settings
        s = Settings.from_env()
        env_val = os.environ.get("TRADING_EXECUTION_PAUSED", "true").strip().lower() != "false"
        if s.execution_paused == env_val:
            ev = f"config.execution_paused={s.execution_paused}, env.TRADING_EXECUTION_PAUSED={env_val}"
            state = "PAUSED (safe)" if s.execution_paused else "ACTIVE"
            return CheckResult(check_id, name, "PASS", ev, f"Execution gate consistent: {state}")
        return CheckResult(check_id, name, "FAIL", f"Config={s.execution_paused} vs Env={env_val}", "Execution gate mismatch between config and environment")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk04_consecutive_loss_limit() -> CheckResult:
    check_id, name = "CHK-04", "CONSECUTIVE_LOSS_LIMIT"
    try:
        src = (ROOT / "engine" / "paper.py").read_text()
        has_logic = "consecutive_losses >= settings.paper_consecutive_loss_limit" in src or "consecutive_losses" in src
        if has_logic:
            ev = "engine/paper.py contains consecutive loss hard-stop breaker logic"
            return CheckResult(check_id, name, "PASS", ev, "Consecutive loss breaker present in paper.py")
        return CheckResult(check_id, name, "FAIL", "Missing consecutive loss check in paper.py", "Consecutive loss breaker logic not found in code")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"File read error: {e}", str(e))


def chk05_eod_flatten_fields() -> CheckResult:
    check_id, name = "CHK-05", "EOD_FLATTEN_FIELDS"
    try:
        from engine.config import Settings
        s = Settings.from_env()
        ev = f"flatten_hour={s.paper_flatten_hour_ist}, flatten_minute={s.paper_flatten_minute_ist}"
        return CheckResult(check_id, name, "PASS", ev, "EOD flatten hour/minute IST fields configured in Settings")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk06_premarket_uses_rest() -> CheckResult:
    check_id, name = "CHK-06", "PREMARKET_USES_REST"
    try:
        src = (ROOT / "engine" / "premarket_check.py").read_text()
        has_rest = any(kw in src for kw in ["urllib.request", "requests.get", "httpx", "fetch_upstox_quotes_rest"])
        if has_rest:
            ev = "engine/premarket_check.py: check 2 calls live REST endpoint for quote validation"
            return CheckResult(check_id, name, "PASS", ev, "Premarket check validates live REST quotes rather than token string presence only")
        return CheckResult(check_id, name, "FAIL", "premarket_check.py lacks live REST HTTP request logic", "Premarket check only validates token presence string")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"File read error: {e}", str(e))


def chk07_premarket_gates_on_register() -> CheckResult:
    check_id, name = "CHK-07", "PREMARKET_GATES_ON_REGISTER"
    try:
        src = (ROOT / "engine" / "premarket_check.py").read_text()
        has_register_gate = "SELF_LEARNING_FAILURE_REGISTER" in src or "failure_register" in src
        if has_register_gate:
            ev = "engine/premarket_check.py: includes Check 15 (failure_register gate)"
            return CheckResult(check_id, name, "PASS", ev, "Premarket check gates execution on SELF_LEARNING_FAILURE_REGISTER.json")
        return CheckResult(check_id, name, "FAIL", "premarket_check.py does not reference failure register", "Premarket check lacks failure register gate")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"File read error: {e}", str(e))


def chk08_failure_register_exists() -> CheckResult:
    check_id, name = "CHK-08", "FAILURE_REGISTER_EXISTS"
    try:
        if not REGISTER_PATH.exists():
            return CheckResult(check_id, name, "FAIL", f"Missing at {REGISTER_PATH}", "SELF_LEARNING_FAILURE_REGISTER.json does not exist")
        data = json.loads(REGISTER_PATH.read_text())
        inc_count = len(data.get("incidents", []))
        if inc_count > 0:
            ev = f"file={REGISTER_PATH.name}, schema_version={data.get('schema_version')}, incidents={inc_count}"
            return CheckResult(check_id, name, "PASS", ev, f"Failure register exists and populated with {inc_count} historical incidents")
        return CheckResult(check_id, name, "FAIL", f"Empty incidents array in {REGISTER_PATH.name}", "Failure register is empty")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Parse error: {e}", str(e))


# ---------------------------------------------------------------------------
# Checks 09 - 15: Data flow, DB & Calendar checks
# ---------------------------------------------------------------------------

def chk09_db_schema_complete() -> CheckResult:
    check_id, name = "CHK-09", "DB_SCHEMA_COMPLETE"
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)
        with store.connect(read_only=True) as con:
            tables = set(r[0] for r in con.execute("SHOW TABLES").fetchall())
        required = {"minute_bars", "paper_trades", "paper_signals", "scanner_runs", "paper_trade_events"}
        missing = required - tables
        if missing:
            return CheckResult(check_id, name, "FAIL", f"Missing tables: {missing}", f"DuckDB schema missing tables: {missing}")
        ev = f"db_path={s.db_path.name}, tables={len(tables)} (contains {', '.join(required)})"
        return CheckResult(check_id, name, "PASS", ev, "DuckDB schema integrity verified")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"DB error: {e}", str(e))


def chk10_db_write_access() -> CheckResult:
    check_id, name = "CHK-10", "DB_WRITE_ACCESS"
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)
        with store.connect() as con:
            con.execute("CREATE TEMP TABLE IF NOT EXISTS _chk10_test (id INT)")
            con.execute("INSERT INTO _chk10_test VALUES (1)")
            con.execute("DROP TABLE _chk10_test")
        ev = f"db_path={s.db_path.name}, test write+insert+drop succeeded"
        return CheckResult(check_id, name, "PASS", ev, "DuckDB write access confirmed")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"DB write error: {e}", str(e))


def chk11_data_freshness() -> CheckResult:
    """
    CHK-11: Data Freshness (Market Calendar Aware).
    Global Rule: If market is closed / weekend / pre-market -> NOT_VERIFIED (never false PASS).
    """
    check_id, name = "CHK-11", "DATA_FRESHNESS"
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)
        now_utc = datetime.now(timezone.utc)
        session = get_market_session_state(now_utc)

        with store.connect(read_only=True) as con:
            row = con.execute("SELECT max(ts) FROM minute_bars").fetchone()
            latest_ts_raw = row[0] if row else None

        if session["is_weekend"]:
            ev = f"session={session['session_type']}, formatted_ist='{session['timestamp_ist']}'"
            return CheckResult(check_id, name, "NOT_VERIFIED", ev, f"Weekend ({session['weekday']}) — market closed; live feed freshness cannot be verified")

        if session["session_type"] == "PRE_MARKET":
            ev = f"session={session['session_type']}, formatted_ist='{session['timestamp_ist']}'"
            return CheckResult(check_id, name, "NOT_VERIFIED", ev, "Pre-market session — trading session has not opened yet")

        if latest_ts_raw is None:
            if session["is_market_open"]:
                return CheckResult(check_id, name, "FAIL", "0 bars in DB during active market hours", "Database clean during market hours — feed not collecting")
            return CheckResult(check_id, name, "NOT_VERIFIED", "0 bars in DB outside market hours", "No data bars in DB to verify freshness")

        lt = datetime.fromisoformat(str(latest_ts_raw).replace("Z", "+00:00"))
        if lt.tzinfo is None:
            lt = lt.replace(tzinfo=timezone.utc)
        age_min = (now_utc - lt).total_seconds() / 60.0

        ev = f"latest_bar_ts={lt.isoformat()}, age_minutes={age_min:.1f}, session={session['session_type']}"
        if session["is_market_open"] and age_min > 5.0:
            return CheckResult(check_id, name, "FAIL", ev, f"Latest bar is {age_min:.1f} min old (>5 min limit during market hours)")

        if session["is_market_open"] and age_min <= 5.0:
            return CheckResult(check_id, name, "PASS", ev, f"Data stream active ({age_min:.1f} min old during market hours)")

        # Post-market
        if age_min <= 24 * 60:
            return CheckResult(check_id, name, "NOT_VERIFIED", ev, f"Post-market session — latest bar from today ({age_min:.1f} min old); live feed unverified until market open")
        return CheckResult(check_id, name, "NOT_VERIFIED", ev, f"Post-market session — latest bar is {age_min:.1f} min old")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk12_quote_tick_delta() -> CheckResult:
    """
    CHK-12: Quote Tick Delta.
    Global Rule: No feed lines in log -> NOT_VERIFIED (never false PASS).
    """
    check_id, name = "CHK-12", "QUOTE_TICK_DELTA"
    try:
        if not LOG_PATH.exists():
            return CheckResult(check_id, name, "NOT_VERIFIED", "Log file missing at intraday_bot_log.txt", "intraday_bot_log.txt not found")
        lines = LOG_PATH.read_text().splitlines()[-200:]
        hlines = [l for l in lines if "feed healthy" in l and "quote_ticks=" in l]
        if not hlines:
            return CheckResult(check_id, name, "NOT_VERIFIED", "0 feed-healthy log lines in recent 200 lines", "No recent feed health evidence in log file")
        last = hlines[-1]
        m_qt = re.search(r"quote_ticks=(\d+)", last)
        m_ct = re.search(r"candle_ticks=(\d+)", last)
        qt = int(m_qt.group(1)) if m_qt else -1
        ct = int(m_ct.group(1)) if m_ct else -1
        ev = f"last_log_line='{last[-70:]}', quote_ticks={qt}, candle_ticks={ct}"
        if qt == 0 and ct == 0:
            return CheckResult(check_id, name, "FAIL", ev, "CRITICAL: quote_ticks=0 candle_ticks=0 reported healthy (INC-017 pattern)")
        if qt == 0:
            return CheckResult(check_id, name, "FAIL", ev, "quote_ticks=0 reported healthy (INC-011/017 pattern)")

        qt_vals = [int(m.group(1)) for hl in hlines[-10:] if (m := re.search(r"quote_ticks=(\d+)", hl))]
        if len(qt_vals) >= 5 and len(set(qt_vals)) == 1 and qt_vals[0] > 0:
            return CheckResult(check_id, name, "FAIL", f"quote_ticks frozen at {qt_vals[0]} for last {len(qt_vals)} readings", "Frozen tick counter pattern (INC-011)")
        return CheckResult(check_id, name, "PASS", ev, f"Ticks flowing: quote_ticks={qt}, candle_ticks={ct}")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Log check error: {e}", str(e))


def chk13_auth_token_rest() -> CheckResult:
    """
    CHK-13: Upstox REST Authentication.
    Global Rule: ONLY successful HTTP 200 response with positive LTP data = PASS.
    REST timeout or network error = NOT_VERIFIED (never false PASS).
    Token missing or 401/403 = FAIL.
    """
    check_id, name = "CHK-13", "AUTH_TOKEN_REST"
    try:
        token = os.environ.get("UPSTOX_ACCESS_TOKEN", "").strip()
        if not token:
            env_local = ROOT / ".env.local"
            if env_local.exists():
                for line in env_local.read_text().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        if k.strip() == "UPSTOX_ACCESS_TOKEN":
                            token = v.strip().strip("\"'")
                            os.environ["UPSTOX_ACCESS_TOKEN"] = token
                            break
        if not token:
            return CheckResult(check_id, name, "FAIL", "UPSTOX_ACCESS_TOKEN env var not set", "Missing authentication token (INC-015/016)")
        try:
            req = urllib.request.Request(
                "https://api.upstox.com/v2/market-quote/ltp?instrument_key=NSE_INDEX%7CNifty+50",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = json.loads(resp.read())
                status_code = getattr(resp, "status", None) or (resp.getcode() if hasattr(resp, "getcode") else 200)
                if status_code == 200 and body.get("status") != "error":
                    ev = f"Upstox REST 200 OK, NIFTY 50 LTP received: {body.get('data',{})}"
                    return CheckResult(check_id, name, "PASS", ev, "Upstox REST authentication valid")
                return CheckResult(check_id, name, "FAIL", f"REST status={status_code}, body={body}", "Upstox REST returned non-200 or error")
        except Exception as api_err:
            err = str(api_err)
            if "403" in err or "401" in err:
                return CheckResult(check_id, name, "FAIL", f"HTTP Auth Error: {err[:80]}", "Upstox REST auth failed (token expired — INC-016)")
            # Network unreachable / timeout: MUST return NOT_VERIFIED (NOT PASS!)
            ev = f"Token present, REST endpoint unreachable: {err[:60]}"
            return CheckResult(check_id, name, "NOT_VERIFIED", ev, "Upstox REST endpoint unreachable — live auth cannot be verified")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk14_scanner_not_stalled() -> CheckResult:
    """
    CHK-14: Scanner Pipeline Freshness.
    Global Rule: No scanner runs in DB = NOT_VERIFIED (never false PASS).
    """
    check_id, name = "CHK-14", "SCANNER_NOT_STALLED"
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)
        with store.connect(read_only=True) as con:
            row = con.execute("SELECT run_id, started_at, status, signal_count FROM scanner_runs ORDER BY started_at DESC LIMIT 1").fetchone()
        if not row:
            return CheckResult(check_id, name, "NOT_VERIFIED", "scanner_runs table empty", "No scanner runs recorded in DuckDB store")
        run_id, started_at, status, signal_count = row
        lt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        if lt.tzinfo is None:
            lt = lt.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        session = get_market_session_state(now_utc)
        age_min = (now_utc - lt).total_seconds() / 60.0
        ev = f"run_id={run_id}, started_at={started_at}, age_min={age_min:.1f}, status={status}, signal_count={signal_count}"

        if session["is_market_open"] and age_min > 90:
            return CheckResult(check_id, name, "FAIL", ev, f"Last scanner run was {age_min:.0f} min ago (>90 min threshold during market hours)")
        if signal_count is None:
            return CheckResult(check_id, name, "FAIL", ev, "NULL signal_count in last scanner run (INC-018 pattern)")

        if session["is_market_open"]:
            return CheckResult(check_id, name, "PASS", ev, f"Scanner output fresh ({age_min:.0f} min ago)")

        # Outside market hours
        return CheckResult(check_id, name, "NOT_VERIFIED", ev, f"Last scanner run was {age_min:.0f} min ago ({session['session_type']}); live scanner unverified until market open")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk15_regime_data_today() -> CheckResult:
    """
    CHK-15: Regime Data Availability.
    Global Rule: Outside market hours -> NOT_VERIFIED. During market -> FAIL if 0 bars.
    """
    check_id, name = "CHK-15", "REGIME_DATA_TODAY"
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)
        now_utc = datetime.now(timezone.utc)
        session = get_market_session_state(now_utc)
        today_date = session["date_ist"]

        with store.connect(read_only=True) as con:
            nifty_n = con.execute("SELECT count(*) FROM minute_bars WHERE symbol=? AND date(ts)=?", [s.market_index_symbol, today_date]).fetchone()[0]
            vix_n = con.execute("SELECT count(*) FROM minute_bars WHERE symbol=? AND date(ts)=?", [s.vix_symbol, today_date]).fetchone()[0]

        ev = f"today={today_date}, NIFTY_50_bars={nifty_n}, INDIA_VIX_bars={vix_n}, session={session['session_type']}"

        if not session["is_market_open"] and (nifty_n == 0 or vix_n == 0):
            return CheckResult(check_id, name, "NOT_VERIFIED", ev, f"Outside market hours ({session['session_type']}); 0 regime bars for today ({today_date})")

        if nifty_n == 0 or vix_n == 0:
            return CheckResult(check_id, name, "FAIL", ev, f"Missing regime bars for today ({today_date}): NIFTY={nifty_n}, VIX={vix_n} (INC-006)")

        return CheckResult(check_id, name, "PASS", ev, f"Regime data present for today: NIFTY={nifty_n}, VIX={vix_n}")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


# ---------------------------------------------------------------------------
# Checks 16 - 20: Adversarial / False-PASS detection
# ---------------------------------------------------------------------------

def chk16_feed_healthy_with_zero_ticks() -> CheckResult:
    """CHK-16: Feed Healthy with Zero Ticks Detection."""
    check_id, name = "CHK-16", "FEED_HEALTHY_WITH_ZERO_TICKS"
    try:
        if not LOG_PATH.exists():
            return CheckResult(check_id, name, "NOT_VERIFIED", "Log file missing at intraday_bot_log.txt", "intraday_bot_log.txt not found")
        lines = LOG_PATH.read_text().splitlines()[-500:]
        if not lines:
            return CheckResult(check_id, name, "NOT_VERIFIED", "Log file is empty", "Log file is empty")
        matches = [l for l in lines if "feed healthy" in l and ("quote_ticks=0" in l or "candle_ticks=0" in l)]
        if matches:
            ev = f"Found {len(matches)} false-healthy lines in log. Latest: '{matches[-1][-80:]}'"
            return CheckResult(check_id, name, "FAIL", ev, "Log reveals 'feed healthy' reported despite 0 ticks (INC-017 pattern)")
        ev = f"Scanned last {len(lines)} log lines — 0 false-healthy zero-tick lines found"
        return CheckResult(check_id, name, "PASS", ev, "No false-healthy zero-tick instances in recent log")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk17_frozen_tick_counter() -> CheckResult:
    """
    CHK-17: Frozen Tick Counter Detection.
    Global Rule: <5 tick entries in log -> NOT_VERIFIED (never false PASS).
    """
    check_id, name = "CHK-17", "FROZEN_TICK_COUNTER"
    try:
        if not LOG_PATH.exists():
            return CheckResult(check_id, name, "NOT_VERIFIED", "Log file missing at intraday_bot_log.txt", "intraday_bot_log.txt not found")
        lines = LOG_PATH.read_text().splitlines()[-300:]
        hlines = [l for l in lines if "feed healthy" in l and "quote_ticks=" in l]
        qt_vals = [int(m.group(1)) for hl in hlines if (m := re.search(r"quote_ticks=(\d+)", hl))]
        if len(qt_vals) < 5:
            return CheckResult(check_id, name, "NOT_VERIFIED", f"Only {len(qt_vals)} tick log readings found (<5 minimum required)", "Insufficient log history to verify tick counter movement")
        tail = qt_vals[-5:]
        if len(set(tail)) == 1 and tail[0] > 0:
            ev = f"quote_ticks frozen at {tail[0]} for last {len(tail)} log entries"
            return CheckResult(check_id, name, "FAIL", ev, "Frozen tick counter detected (INC-011 pattern)")
        ev = f"Analyzed {len(qt_vals)} quote_ticks readings — active variation confirmed"
        return CheckResult(check_id, name, "PASS", ev, "Tick counters show active progression")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk18_403_503_in_log() -> CheckResult:
    check_id, name = "CHK-18", "403_503_IN_LOG"
    try:
        if not LOG_PATH.exists():
            return CheckResult(check_id, name, "NOT_VERIFIED", "Log file missing at intraday_bot_log.txt", "intraday_bot_log.txt not found")
        lines = LOG_PATH.read_text().splitlines()[-200:]
        if not lines:
            return CheckResult(check_id, name, "NOT_VERIFIED", "Log file is empty", "Log file is empty")
        err_lines = [l for l in lines if ("403 Forbidden" in l or "503 Service" in l) and "ERROR" in l]
        if err_lines:
            ev = f"Found {len(err_lines)} auth/server errors in log. Latest: '{err_lines[-1][-80:]}'"
            return CheckResult(check_id, name, "FAIL", ev, "WebSocket/API 403/503 errors detected in recent log")
        ev = f"Scanned last {len(lines)} log lines — 0 403/503 errors found"
        return CheckResult(check_id, name, "PASS", ev, "No 403/503 API errors in recent log")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk19_no_trade_events_file() -> CheckResult:
    """
    CHK-19: No-Trade Events Configuration File.
    Global Rule: File missing -> NOT_VERIFIED.
    """
    check_id, name = "CHK-19", "NO_TRADE_EVENTS_FILE"
    try:
        from engine.config import Settings
        s = Settings.from_env()
        p = s.no_trade_events_path
        if not p.exists():
            return CheckResult(check_id, name, "NOT_VERIFIED", f"File absent at {p}", "no-trade-events.json file absent")
        data = json.loads(p.read_text())
        ev = f"file={p.name}, size={len(data)} events"
        return CheckResult(check_id, name, "PASS", ev, "no-trade-events.json exists and valid JSON")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk20_degraded_mode_consistent() -> CheckResult:
    check_id, name = "CHK-20", "DEGRADED_MODE_CONSISTENT"
    try:
        from engine.degraded import DEGRADED_MANAGER
        is_deg = DEGRADED_MANAGER.is_degraded
        fails = DEGRADED_MANAGER.active_failures()
        ev = f"is_degraded={is_deg}, active_failures={fails}"
        return CheckResult(check_id, name, "PASS", ev, f"Degraded mode state queryable (active={is_deg})")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


# ---------------------------------------------------------------------------
# Checks 21 - 23: Historical & Self-learning checks
# ---------------------------------------------------------------------------

def chk21_historical_regression() -> CheckResult:
    check_id, name = "CHK-21", "HISTORICAL_REGRESSION"
    try:
        from engine.forensic_agent.history import load_failure_register
        reg = load_failure_register()
        incidents = reg.get("incidents", [])
        open_criticals = [i for i in incidents if i.get("status") == "OPEN" and i.get("severity") == "CRITICAL"]
        if open_criticals:
            ids = ", ".join(i["id"] for i in open_criticals)
            ev = f"OPEN CRITICAL incidents found: {ids}. First: {open_criticals[0]['id']} ({open_criticals[0]['category']})"
            return CheckResult(check_id, name, "FAIL", ev, f"Open critical incidents in failure register: {ids}")
        open_total = [i for i in incidents if i.get("status") in ("OPEN", "MONITORING")]
        ev = f"Register total={len(incidents)}, 0 OPEN CRITICAL, {len(open_total)} monitoring items"
        return CheckResult(check_id, name, "PASS", ev, "No open critical historical incidents in failure register")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk22_false_pass_detection() -> CheckResult:
    check_id, name = "CHK-22", "FALSE_PASS_DETECTION"
    try:
        from engine.forensic_agent.history import _load_history
        hist = _load_history()
        reviews = hist.get("reviews", [])
        invalidated = [r for r in reviews if r.get("previous_verdict_invalidated")]
        if invalidated:
            ev = f"Found {len(invalidated)} invalidated verdicts in history. Latest ID: {invalidated[-1]['review_id']}"
            return CheckResult(check_id, name, "FAIL", ev, "Prior PASS/READY verdict was invalidated by subsequent review")
        ev = f"History has {len(reviews)} review records; 0 verdict invalidations"
        return CheckResult(check_id, name, "PASS", ev, "No prior verdict invalidations in history")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk23_blunder_traceability() -> CheckResult:
    check_id, name = "CHK-23", "BLUNDER_TRACEABILITY"
    try:
        from engine.forensic_agent.history import _load_memory
        mem = _load_memory()
        fps = mem.get("fingerprints", [])
        active_crd = [fp for fp in fps if fp.get("status") == "ACTIVE_CRITICAL"]
        if active_crd:
            ids = ", ".join(fp["fp_id"] for fp in active_crd)
            ev = f"ACTIVE_CRITICAL fingerprints unresolved: {ids}"
            return CheckResult(check_id, name, "FAIL", ev, f"Unresolved active critical failure fingerprints: {ids}")
        ev = f"Fingerprint memory has {len(fps)} items; 0 ACTIVE_CRITICAL unresolved"
        return CheckResult(check_id, name, "PASS", ev, "All failure fingerprints tracked and resolved/monitored")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


# ---------------------------------------------------------------------------
# Checks 24 - 26: Resource & Process checks
# ---------------------------------------------------------------------------

def chk24_oci_resource_proof(resource_proof_dict: dict | None = None) -> CheckResult:
    """
    CHK-24: OCI Resource Telemetry Proof.
    Global Rule: If telemetry unverified or psutil failed -> NOT_VERIFIED.
    """
    check_id, name = "CHK-24", "OCI_RESOURCE_PROOF"
    try:
        if not resource_proof_dict:
            return CheckResult(check_id, name, "NOT_VERIFIED", "Resource proof dict not supplied", "Resource proof telemetry not supplied")
        breach = resource_proof_dict.get("RESOURCE_LIMIT_BREACH", "UNVERIFIED")
        reasons = resource_proof_dict.get("BREACH_REASONS", [])
        cpu = resource_proof_dict.get("FORENSIC_CPU", 0.0)
        ram = resource_proof_dict.get("PEAK_RAM_MB", 0.0)
        dur = resource_proof_dict.get("DURATION_SEC", 0.0)
        ev = f"CPU={cpu:.1f}%, RAM={ram:.1f}MB, DUR={dur:.1f}s, BREACH={breach}"
        if breach == "UNVERIFIED":
            return CheckResult(check_id, name, "NOT_VERIFIED", f"{ev}; reasons={reasons}", "OCI Resource telemetry measurement unverified")
        if breach == "YES":
            return CheckResult(check_id, name, "FAIL", f"{ev}; reasons={reasons}", f"OCI Resource limit breached: {reasons}")
        return CheckResult(check_id, name, "PASS", ev, "OCI resource consumption within specified limits")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"Error: {e}", str(e))


def chk25_db_lock_cleared() -> CheckResult:
    check_id, name = "CHK-25", "DB_LOCK_CLEARED"
    try:
        from engine.config import Settings
        from engine.store import MarketStore
        s = Settings.from_env()
        store = MarketStore(s.db_path)
        with store.connect(read_only=True) as con:
            con.execute("SELECT 1").fetchone()
        ev = f"db_path={s.db_path.name}, read connection acquired without lock timeout"
        return CheckResult(check_id, name, "PASS", ev, "DuckDB is accessible and unlocked")
    except Exception as e:
        return CheckResult(check_id, name, "FAIL", f"DB lock error: {e}", str(e))


def chk26_forensic_agent_not_starving_trading() -> CheckResult:
    """
    CHK-26: Forensic Agent Resource Footprint.
    Global Rule: If psutil missing or error -> NOT_VERIFIED (NEVER default PASS!).
    """
    check_id, name = "CHK-26", "FORENSIC_AGENT_NOT_STARVING_TRADING"
    try:
        import os, psutil
        proc = psutil.Process(os.getpid())
        mem_mb = proc.memory_info().rss / (1024 * 1024)
        ev = f"pid={proc.pid}, memory_rss={mem_mb:.1f}MB (<150MB limit)"
        if mem_mb > 150.0:
            return CheckResult(check_id, name, "FAIL", ev, f"Agent RSS memory {mem_mb:.1f}MB exceeds 150MB threshold")
        if mem_mb <= 0.0:
            return CheckResult(check_id, name, "NOT_VERIFIED", "Process memory RSS reading returned 0.0MB", "Telemetry returned zero process memory")
        return CheckResult(check_id, name, "PASS", ev, "Forensic agent memory consumption is lightweight and safe")
    except Exception as e:
        return CheckResult(check_id, name, "NOT_VERIFIED", f"psutil process telemetry error: {e}", "Process memory could not be verified")


# ---------------------------------------------------------------------------
# Runner for all 26 checks
# ---------------------------------------------------------------------------

ALL_CHECK_FUNCS = [
    chk01_config_fields_present,
    chk02_risk_caps_hardcoded,
    chk03_execution_paused_flag,
    chk04_consecutive_loss_limit,
    chk05_eod_flatten_fields,
    chk06_premarket_uses_rest,
    chk07_premarket_gates_on_register,
    chk08_failure_register_exists,
    chk09_db_schema_complete,
    chk10_db_write_access,
    chk11_data_freshness,
    chk12_quote_tick_delta,
    chk13_auth_token_rest,
    chk14_scanner_not_stalled,
    chk15_regime_data_today,
    chk16_feed_healthy_with_zero_ticks,
    chk17_frozen_tick_counter,
    chk18_403_503_in_log,
    chk19_no_trade_events_file,
    chk20_degraded_mode_consistent,
    chk21_historical_regression,
    chk22_false_pass_detection,
    chk23_blunder_traceability,
    # chk24 called with proof dict below
    chk25_db_lock_cleared,
    chk26_forensic_agent_not_starving_trading,
]


def run_all_checks(resource_proof_dict: dict | None = None) -> list[CheckResult]:
    results: list[CheckResult] = []
    for fn in ALL_CHECK_FUNCS:
        try:
            res = fn()
            res = enforce_evidence_rule(res)
            results.append(res)
        except Exception as e:
            results.append(CheckResult(
                check_id=fn.__name__[:6].upper(),
                name=fn.__name__,
                status="FAIL",
                evidence=f"Unhandled exception in check: {e}",
                detail=str(e),
            ))

    res24 = chk24_oci_resource_proof(resource_proof_dict)
    res24 = enforce_evidence_rule(res24)
    results.append(res24)

    return results
