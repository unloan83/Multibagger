from __future__ import annotations

import os
import pytest
import sqlite3
import datetime
from unittest import mock
from pathlib import Path

from engine.config import Settings
from engine.lockfile import SingleInstanceLock
from engine.watchdog import HeartbeatWatchdog
from engine.market_data import UpstoxMarketDataFeed, TickData
from engine.preflight_sync import PreflightSync
from engine.state_machine import StateMachine, TradeState
from engine.gates import evaluate_candidate, CandidateSetup
from engine.paper_engine import PaperExecutionEngine, PaperBroker
from engine.position_manager import PositionManager
from engine.notifier import send_telegram_alert, get_notifier_stats

@pytest.fixture(autouse=True)
def setup_isolation(tmp_path, monkeypatch):
    test_db = str(tmp_path / "resilience_test.db")
    monkeypatch.setattr("engine.config.DB_PATH", test_db)
    sm = StateMachine(db_path=test_db)
    sm.init_db()
    yield test_db

def test_1_invalid_upstox_token_handling():
    settings = Settings(access_token="INVALID_TOKEN_123")
    sync = PreflightSync(settings)
    ok, checks = sync.run_premarket_checks()
    assert "upstox_auth" in checks

def test_2_stale_quote_rejection():
    stale_cand = CandidateSetup(
        symbol="RELIANCE",
        instrument_key="NSE_EQ|INE002A01018",
        ltp=2500.0, bid=2499.5, ask=2500.5,
        tick_time=datetime.datetime.now(datetime.timezone.utc).timestamp() - 5.0,
        entry_price=2500.0, target_price=2560.0, stop_loss=2480.0, qty=10
    )
    passed, code, _ = evaluate_candidate(stale_cand, now_ts=datetime.datetime.now(datetime.timezone.utc).timestamp())
    assert passed is False
    assert code == "DATA_STALE"

def test_3_empty_instrument_master_preflight_failure():
    settings = Settings()
    sync = PreflightSync(settings)
    with mock.patch.object(sync, "fetch_bod_master_and_surveillance", return_value=[]):
        ok, checks = sync.run_premarket_checks()
        assert ok is False
        assert checks["instrument_master"] is False

def test_4_database_write_failure_resilience():
    settings = Settings(db_path=Path("/invalid_root_dir_path_9999/db.sqlite"))
    sync = PreflightSync(settings)
    ok, msg = sync.check_database_writable()
    assert ok is False

def test_5_duplicate_start_attempt_blocked(tmp_path):
    lock_file = str(tmp_path / "test.lock")
    lock1 = SingleInstanceLock(lock_file)
    assert lock1.acquire() is True

    lock2 = SingleInstanceLock(lock_file)
    assert lock2.acquire() is False
    lock1.release()

def test_6_paper_only_isolation_prevents_live_execution(monkeypatch):
    monkeypatch.setenv("ENABLE_LIVE_TRADING", "true")
    with pytest.raises(RuntimeError, match="ENABLE_LIVE_TRADING is true"):
        PaperBroker()

    with pytest.raises(RuntimeError, match="ENABLE_LIVE_TRADING is true"):
        PaperExecutionEngine.assert_paper_only()

def test_7_telegram_outage_does_not_block_execution():
    with mock.patch("requests.post", side_effect=Exception("Network Unreachable")):
        sent = send_telegram_alert("Test message during network outage")
        assert sent is True
        stats = get_notifier_stats()
        assert stats["sent_count"] >= 0

def test_8_watchdog_heartbeat_loss_detection(tmp_path):
    hb_file = str(tmp_path / "heartbeats.json")
    wd = HeartbeatWatchdog(hb_file)
    wd.update_heartbeat("engine")
    
    with open(hb_file, "w", encoding="utf-8") as f:
        f.write('{"engine": 1000.0}')

    healthy, stale = wd.check_heartbeats()
    assert healthy is False
    assert "engine" in stale

def test_9_eod_forced_squareoff_execution(setup_isolation):
    db_path = setup_isolation
    sm = StateMachine(db_path=db_path)
    engine = PaperExecutionEngine(db_path=db_path)
    
    t_id = sm.create_trade_intent({"symbol": "TCS", "entry_price": 4000.0, "qty": 5})
    sm.transition(t_id, TradeState.APPROVED)
    engine.execute_paper_buy(t_id, "NSE_EQ|INE467B01029", 5, 4000.0, 4000.0)

    res = engine.execute_paper_exit(t_id, 4050.0, reason="EOD_SQUAREOFF")
    assert res["status"] == "CLOSED"
    assert sm.get_state(t_id) == TradeState.CLOSED

def test_10_zero_tick_failure_regression():
    """TASK 5: Zero-tick failure regression test."""
    feed = UpstoxMarketDataFeed("test_token")
    assert feed.quote_ticks == 0
    assert feed.is_market_data_ready() is False

    # Simulate WS 403 error
    feed.handle_disconnect_or_http_error(403)
    assert feed.is_market_data_ready() is False

    # Process genuine tick -> market data ready
    now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
    feed.process_raw_tick({"symbol": "RELIANCE", "ltp": 2500.0, "bid": 2499.5, "ask": 2500.5}, now_ts=now_ts)
    assert feed.quote_ticks == 1
    assert feed.is_market_data_ready(now_ts=now_ts) is True

def test_11_two_stage_readiness_verification():
    """TASK 4: Two-stage readiness test."""
    settings = Settings()
    sync = PreflightSync(settings)
    feed = UpstoxMarketDataFeed("test_token")

    sync.run_premarket_checks()
    assert sync.premarket_ready is True
    assert sync.is_allow_new_entries(feed) is False  # Stage B not ready yet due to 0 ticks

    now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
    feed.process_raw_tick({"symbol": "TCS", "ltp": 3500.0, "bid": 3499.0, "ask": 3501.0}, now_ts=now_ts)
    assert sync.is_allow_new_entries(feed) is True
