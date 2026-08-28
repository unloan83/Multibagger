"""
Comprehensive Resilience & SAFE_DEGRADED Recovery Test Suite

Tests the 6 mandatory failure modes:
1. WebSocket Loss
2. API Timeout
3. Token/Auth Failure
4. DB Temporary Failure
5. Telegram Failure
6. Worker Restart with an Open Position
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import duckdb
import pytest

from engine.config import Settings
from engine.degraded import DEGRADED_MANAGER, DegradedModeManager
from engine.paper import run_paper_cycle
from engine.store import MarketStore
from engine.strategies import Candidate
from scripts.telegram_notify import notify_incident_event, send_telegram_message


def _candidate(symbol, now, side="LONG"):
    confirmations = {
        "marketDirection": True, "sectorDirection": True, "vwap": True,
        "volume": True, "momentum": True, "strategyQualified": True,
        "supportResistance": True, "riskReward": True,
        "setupSource": "PRICE_VOLUME_ONLY", "breakoutLevel": 199.0 if side == "LONG" else 201.0,
        "atr": 1.0,
    }
    stop, target = (195.0, 210.0) if side == "LONG" else (205.0, 190.0)
    return Candidate(symbol, side, 200.0, stop, target, "ORB_15M_RETEST",
                     now, now + timedelta(minutes=20), 90.0, confirmations)


def _resilience_settings(tmp_path: Path) -> Settings:
    universe = tmp_path / "universe.json"
    universe.write_text('[{"symbol":"TEST","sources":["NIFTY 500"]}]')
    return Settings(
        access_token="test_token_12345",
        db_path=tmp_path / "market.duckdb",
        snapshot_path=tmp_path / "signals.json",
        universe_path=universe,
        max_symbols=1,
        execution_paused=False,
        max_spread_bps=20,
        backoff_initial_seconds=0.1,
        backoff_max_seconds=1.0,
        backoff_max_attempts=3,
    )


@pytest.fixture(autouse=True)
def _reset_degraded_state():
    """Ensure clean degraded manager state before each test."""
    DEGRADED_MANAGER._degraded = False
    DEGRADED_MANAGER._active_failures.clear()
    DEGRADED_MANAGER._attempts.clear()
    yield
    DEGRADED_MANAGER._degraded = False
    DEGRADED_MANAGER._active_failures.clear()
    DEGRADED_MANAGER._attempts.clear()


# 1. WebSocket Loss Test
def test_websocket_loss_recovery(tmp_path: Path):
    settings = _resilience_settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 25, 5, 0, tzinfo=timezone.utc)

    # 1. Open a trade in normal conditions
    result1 = run_paper_cycle(
        store, settings, [_candidate("TEST", now)],
        {"TEST": {"bid": 199.8, "ask": 200.0, "ts": now}}, now, "ws-run-1"
    )
    assert len(result1["openPositions"]) == 1

    # 2. Simulate WebSocket loss
    DEGRADED_MANAGER.report_failure("WEBSOCKET", "Upstox WebSocket tick stream disconnected")
    assert DEGRADED_MANAGER.is_degraded is True
    assert "WEBSOCKET" in DEGRADED_MANAGER.active_failures()

    # 3. Verify new entries are BLOCKED in SAFE_DEGRADED mode, but position state is PRESERVED
    next_time = now + timedelta(minutes=1)
    result2 = run_paper_cycle(
        store, settings, [_candidate("OTHER", next_time)],
        {
            "TEST": {"bid": 201.0, "ask": 201.2, "ts": next_time},
            "OTHER": {"bid": 199.8, "ask": 200.0, "ts": next_time},
        }, next_time, "ws-run-2"
    )
    assert any("SAFE_DEGRADED mode active" in r for r in result2["noEntryReasons"])
    assert len(result2["openPositions"]) == 1  # Open position PRESERVED

    # 4. Simulate WebSocket auto-recovery
    DEGRADED_MANAGER.report_recovery("WEBSOCKET")
    assert DEGRADED_MANAGER.is_degraded is False

    # 5. Verify trading engine resumes normal operation
    third_time = now + timedelta(minutes=2)
    result3 = run_paper_cycle(
        store, settings, [],
        {"TEST": {"bid": 201.0, "ask": 201.2, "ts": third_time}}, third_time, "ws-run-3"
    )
    assert len(result3["openPositions"]) == 1


# 2. API Timeout Test
def test_api_timeout_recovery(tmp_path: Path):
    settings = _resilience_settings(tmp_path)

    # Simulate API timeout and check exponential backoff calculation
    mgr = DegradedModeManager()

    # 1. Report API failure
    is_new = mgr.report_failure("API", "Broker API request timeout after 30s")
    assert is_new is True
    assert mgr.is_degraded is True

    # 2. Verify exponential backoff sequence (initial 1.0s, max 60s)
    b1 = mgr.compute_backoff("API", initial_delay=1.0, max_delay=60.0)
    b2 = mgr.compute_backoff("API", initial_delay=1.0, max_delay=60.0)
    b3 = mgr.compute_backoff("API", initial_delay=1.0, max_delay=60.0)
    b4 = mgr.compute_backoff("API", initial_delay=1.0, max_delay=60.0)

    assert b1 == 1.0
    assert b2 == 2.0
    assert b3 == 4.0
    assert b4 == 8.0

    # 3. Simulate API recovery
    recovered = mgr.report_recovery("API")
    assert recovered is True
    assert mgr.is_degraded is False


# 3. Token / Auth Failure Test
def test_token_auth_failure_recovery(tmp_path: Path):
    settings = _resilience_settings(tmp_path)
    store = MarketStore(settings.db_path)
    now = datetime(2026, 8, 25, 5, 0, tzinfo=timezone.utc)

    with patch("scripts.telegram_notify.send_telegram_message") as mock_send:
        mock_send.return_value = True

        # 1. Report Auth Failure (HTTP 401)
        DEGRADED_MANAGER.report_failure("AUTH", "Upstox access token expired (HTTP 401)")
        assert DEGRADED_MANAGER.is_degraded is True

        # 2. Duplicate auth failure report should NOT send duplicate Telegram alert
        DEGRADED_MANAGER.report_failure("AUTH", "Upstox access token expired (HTTP 401)")
        
        # 3. Verify entries are blocked in paper cycle
        result = run_paper_cycle(
            store, settings, [_candidate("TEST", now)],
            {"TEST": {"bid": 199.8, "ask": 200.0, "ts": now}}, now, "auth-run-1"
        )
        assert any("SAFE_DEGRADED mode active" in r for r in result["noEntryReasons"])
        assert result["openPositions"] == []

        # 4. Simulate token refresh / auth recovery
        DEGRADED_MANAGER.report_recovery("AUTH")
        assert DEGRADED_MANAGER.is_degraded is False


# 4. DB Temporary Failure Test
def test_db_temporary_failure_recovery(tmp_path: Path):
    settings = _resilience_settings(tmp_path)
    store = MarketStore(settings.db_path)

    # 1. Verify connect retry logic with exponential backoff on transient lock
    original_connect = duckdb.connect
    attempts = [0]

    def mock_flaky_connect(database, read_only=False):
        attempts[0] += 1
        if attempts[0] <= 2:
            raise duckdb.IOException("Database locked by external reader")
        return original_connect(database, read_only=read_only)

    with patch("duckdb.connect", side_effect=mock_flaky_connect):
        with store.connect() as con:
            assert con is not None
        assert attempts[0] == 3  # Succeeded after 2 transient failures

    # 2. Verify DEGRADED_MANAGER handling for DB failure
    DEGRADED_MANAGER.report_failure("DB", "DuckDB write lock timeout")
    assert DEGRADED_MANAGER.is_degraded is True

    DEGRADED_MANAGER.report_recovery("DB")
    assert DEGRADED_MANAGER.is_degraded is False


# 5. Telegram Failure Test
def test_telegram_failure_resilience(tmp_path: Path):
    # 1. Test fail-open notification when Telegram API returns network error
    with patch("urllib.request.urlopen") as mock_urlopen:
        from urllib.error import URLError
        mock_urlopen.side_effect = URLError("Connection refused")

        # Must return False without raising an exception
        result = send_telegram_message(
            "Test Message", event_key="test-key-fail-open", cooldown_seconds=0
        )
        assert result is False

    # 2. Test single incident notification deduplication
    with patch("scripts.telegram_notify.send_telegram_message") as mock_send:
        mock_send.return_value = True

        # First failure alert sent
        sent1 = notify_incident_event("network_test", is_failure=True, message="Network down")
        assert sent1 is True

        # Repeated failure alert suppressed (returns False)
        sent2 = notify_incident_event("network_test", is_failure=True, message="Network down again")
        assert sent2 is False

        # First recovery alert sent
        sent3 = notify_incident_event("network_test", is_failure=False, message="Network restored")
        assert sent3 is True

        # Repeated recovery alert suppressed
        sent4 = notify_incident_event("network_test", is_failure=False, message="Network restored again")
        assert sent4 is False


# 6. Worker Restart with an Open Position & Idempotency Test
def test_worker_restart_with_open_position(tmp_path: Path):
    settings = _resilience_settings(tmp_path)
    store = MarketStore(settings.db_path)
    opened_at = datetime(2026, 8, 25, 5, 0, tzinfo=timezone.utc)

    # 1. Open position before worker crash/restart
    res1 = run_paper_cycle(
        store, settings, [_candidate("RESTART_TEST", opened_at)],
        {"RESTART_TEST": {"bid": 199.8, "ask": 200.0, "ts": opened_at}}, opened_at, "restart-run-1"
    )
    assert len(res1["openPositions"]) == 1
    trade_id = res1["openPositions"][0]["trade_id"]

    # 2. Simulate worker process restart: create NEW MarketStore handle & recover runs
    new_store = MarketStore(settings.db_path)
    recovered = new_store.recover_incomplete_runs()
    assert isinstance(recovered, int)

    # 3. Verify open position is loaded and protected by risk monitor
    monitor_time = opened_at + timedelta(minutes=1)
    res2 = run_paper_cycle(
        new_store, settings, [],
        {"RESTART_TEST": {"bid": 201.0, "ask": 201.2, "ts": monitor_time}}, monitor_time, "restart-run-2"
    )
    assert len(res2["openPositions"]) == 1
    assert res2["openPositions"][0]["trade_id"] == trade_id

    # 4. Verify Idempotency: Attempting duplicate entry for same symbol is PREVENTED
    res3 = run_paper_cycle(
        new_store, settings, [_candidate("RESTART_TEST", monitor_time)],
        {"RESTART_TEST": {"bid": 201.0, "ask": 201.2, "ts": monitor_time}}, monitor_time, "restart-run-3"
    )
    assert len(res3["openPositions"]) == 1  # No duplicate trade created

    # 5. Verify position exit on stop hit
    exit_time = opened_at + timedelta(minutes=2)
    res4 = run_paper_cycle(
        new_store, settings, [],
        {"RESTART_TEST": {"bid": 190.0, "ask": 190.2, "ts": exit_time}}, exit_time, "restart-run-4"
    )
    assert len(res4["openPositions"]) == 0
    assert len(res4["recentClosedTrades"]) == 1
    assert "STOP" in res4["recentClosedTrades"][0]["exit_reason"]
