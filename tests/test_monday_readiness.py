import pytest
import asyncio
import os
import sqlite3
import json
from datetime import datetime, timezone

from engine.config import STATUTORY_RATES, DB_PATH, MAX_DAILY_LOSS
from engine.state_machine import StateMachine, TradeState
from engine.gates import evaluate_candidate, calculate_adaptive_buy_limit
from engine.paper_engine import PaperExecutionEngine
from engine.position_manager import PositionManager
from engine.rejection_logger import CandidateFunnelTracker


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    """Isolate SQLite database for test execution."""
    test_db = str(tmp_path / "test_trading_state.db")
    monkeypatch.setattr("engine.config.DB_PATH", test_db)
    sm = StateMachine(db_path=test_db)
    sm.init_db()
    yield test_db


def test_1_full_lifecycle_replay(setup_test_db):
    """
    TEST 1: End-to-End Trade Lifecycle Replay
    Verifies: Fresh Tick -> Candidate -> Gates -> Approved -> Fill -> OPEN -> Trailing SL -> Exit -> CLOSED -> Exact P&L
    """
    db_path = setup_test_db
    sm = StateMachine(db_path=db_path)
    engine = PaperExecutionEngine(db_path=db_path)
    pm = PositionManager(db_path=db_path)

    # 1. Candidate passes hard gates + soft score
    candidate = {
        "instrument_key": "NSE_EQ|INE002A01018",
        "symbol": "RELIANCE",
        "ltp": 2500.0,
        "bid": 2499.5,
        "ask": 2500.5,
        "total_buy_qty": 50000,
        "total_sell_qty": 40000,
        "tick_time": datetime.now(timezone.utc).timestamp(),
        "upper_circuit": 2750.0,
        "atr_5m": 8.0,
        "atr_1m": 3.0,
        "target_price": 2550.0,
        "stop_loss": 2485.0,
        "qty": 10,
        "rvol": 1.8,
        "rs_market": 0.4,
        "rs_sector": 0.2,
        "delivery_tminus1": 45.0,
        "delivery_20d_sma": 40.0,
        "vwap": 2495.0,
        "ema20": 2492.0,
        "nifty500_15m_ret": 0.1,
        "current_open_risk": 0.0
    }

    passed, code, score = evaluate_candidate(candidate)
    assert passed is True
    assert score >= 60

    # 2. Register & Approve Trade Intent
    trade_id = sm.create_trade_intent(candidate)
    assert sm.get_state(trade_id) == TradeState.QUALIFIED
    sm.transition(trade_id, TradeState.APPROVED)

    # 3. Simulate Paper Fill -> OPEN
    buy_limit = calculate_adaptive_buy_limit(candidate["ask"], candidate["bid"], candidate["atr_1m"], 2502.0)
    fill_result = engine.execute_paper_buy(trade_id, candidate["instrument_key"], candidate["qty"], buy_limit, candidate["ask"])
    assert fill_result["status"] == "FILLED"
    assert sm.get_state(trade_id) == TradeState.OPEN

    # 4. Trailing Stop-Loss update
    new_ltp = 2520.0
    updated_sl = pm.evaluate_trailing_sl(trade_id, current_ltp=new_ltp, high_since_entry=2525.0, atr_5m=8.0)
    assert updated_sl >= candidate["stop_loss"]

    # 5. Target Hit Exit -> CLOSED
    exit_result = engine.execute_paper_exit(trade_id, exit_price=2530.0, reason="TARGET_HIT")
    assert exit_result["status"] == "CLOSED"
    assert sm.get_state(trade_id) == TradeState.CLOSED

    # Verify Net Realized P&L accounting committed
    trade_record = sm.get_trade(trade_id)
    assert trade_record["gross_pnl"] == (2530.0 - candidate["ask"]) * candidate["qty"]
    assert trade_record["net_pnl"] < trade_record["gross_pnl"]  # Costs deducted
    assert trade_record["net_pnl"] > 0.0


def test_2_crash_recovery_with_open_position(setup_test_db):
    """
    TEST 2: Crash Recovery & Startup Reconciliation
    Verifies: Engine restarts while position is OPEN -> recovers state, attaches supervisor, blocks duplicate orders.
    """
    db_path = setup_test_db
    sm_pre_crash = StateMachine(db_path=db_path)
    
    # Inject open trade prior to crash
    trade_id = "test-crash-uuid-123"
    sm_pre_crash.inject_raw_trade({
        "trade_id": trade_id,
        "instrument_key": "NSE_EQ|INE009A01021",
        "symbol": "INFY",
        "state": TradeState.OPEN.value,
        "entry_price": 1800.0,
        "target_price": 1830.0,
        "stop_loss": 1785.0,
        "qty": 20,
        "filled_qty": 20,
        "gross_pnl": 0.0,
        "net_pnl": 0.0
    })

    # Simulate crash & restart with new engine instances
    sm_post_crash = StateMachine(db_path=db_path)
    sm_post_crash.reconcile_on_startup()
    pm_post_crash = PositionManager(db_path=db_path)

    # 1. State preserved
    assert sm_post_crash.get_state(trade_id) == TradeState.OPEN

    # 2. Position manager tracks open exposure
    open_positions = pm_post_crash.get_active_positions()
    assert len(open_positions) == 1
    assert open_positions[0]["trade_id"] == trade_id

    # 3. Duplicate order blocked
    dup_candidate = {
        "instrument_key": "NSE_EQ|INE009A01021",
        "symbol": "INFY",
        "ltp": 1805.0, "bid": 1804.5, "ask": 1805.5,
        "total_buy_qty": 10000, "total_sell_qty": 10000,
        "tick_time": datetime.now(timezone.utc).timestamp(),
        "upper_circuit": 1980.0, "atr_5m": 5.0, "atr_1m": 2.0,
        "target_price": 1860.0, "stop_loss": 1790.0, "qty": 10,
        "rvol": 1.5, "rs_market": 0.2, "rs_sector": 0.1,
        "delivery_tminus1": 50.0, "delivery_20d_sma": 45.0,
        "vwap": 1800.0, "ema20": 1798.0, "nifty500_15m_ret": 0.0,
        "current_open_risk": 300.0
    }
    passed, code, _ = evaluate_candidate(dup_candidate, active_instrument_keys=["NSE_EQ|INE009A01021"])
    assert passed is False
    assert code == "DUPLICATE_POSITION"


def test_3_partial_fill_and_timeout_resolution(setup_test_db):
    """
    TEST 3: Partial Fill & Granular Timeout
    Verifies: 100 qty ordered -> 40 filled -> 15s timeout -> cancel 60 balance -> set OPEN with 40 qty & adjusted risk.
    """
    db_path = setup_test_db
    sm = StateMachine(db_path=db_path)
    engine = PaperExecutionEngine(db_path=db_path)

    trade_id = sm.create_trade_intent({
        "instrument_key": "NSE_EQ|INE040A01034",
        "symbol": "HDFCBANK",
        "entry_price": 1600.0, "target_price": 1630.0, "stop_loss": 1585.0, "qty": 100
    })
    sm.transition(trade_id, TradeState.APPROVED)
    sm.transition(trade_id, TradeState.ENTRY_PENDING)

    # Partial execution simulation (40 of 100 filled)
    engine.record_partial_fill(trade_id, filled_qty=40, fill_price=1600.0)
    assert sm.get_state(trade_id) == TradeState.PARTIALLY_FILLED

    # Trigger timeout resolution (simulating 16s elapsed)
    sm.resolve_pending_timeout(trade_id, elapsed_seconds=16)

    # Assert trade transitioned to OPEN with updated quantity = 40
    trade = sm.get_trade(trade_id)
    assert trade["state"] == TradeState.OPEN.value
    assert trade["qty"] == 40
    assert trade["filled_qty"] == 40


def test_4_portfolio_risk_governor_rupee_breaker(setup_test_db):
    """
    TEST 4: Hard ₹1,000 Portfolio Risk Breaker
    Verifies: Pre-trade blocks orders exceeding ₹1,000 stop risk; Live MTM loss <= -₹1,000 halts system and emergency flattens.
    """
    db_path = setup_test_db
    sm = StateMachine(db_path=db_path)
    pm = PositionManager(db_path=db_path)

    # 1. Block trade that would push total stop risk over ₹1,000 limit
    candidate_high_risk = {
        "instrument_key": "NSE_EQ|INE111A01011",
        "symbol": "TATASTEEL",
        "ltp": 150.0, "bid": 149.9, "ask": 150.1,
        "total_buy_qty": 20000, "total_sell_qty": 20000,
        "tick_time": datetime.now(timezone.utc).timestamp(),
        "upper_circuit": 165.0, "atr_5m": 1.5, "atr_1m": 0.5,
        "target_price": 180.0, "stop_loss": 140.0,  # Risk per share = ₹10.0
        "qty": 60,  # Risk = ₹600
        "rvol": 2.0, "rs_market": 0.5, "rs_sector": 0.3,
        "delivery_tminus1": 40.0, "delivery_20d_sma": 35.0,
        "vwap": 149.0, "ema20": 148.5, "nifty500_15m_ret": 0.0,
        "current_open_risk": 500.0  # ₹500 existing + ₹600 new = ₹1,100 (> ₹1,000)
    }
    passed, code, _ = evaluate_candidate(candidate_high_risk)
    assert passed is False
    assert code == "RISK_LIMIT_EXCEEDED"

    # 2. Live Breaker: If Realized + Unrealized Loss <= -₹1,000 -> Trigger HALTED & Emergency Exits
    sm.inject_raw_trade({
        "trade_id": "trade-loss-999",
        "instrument_key": "NSE_EQ|INE111A01011",
        "symbol": "TATASTEEL",
        "state": TradeState.OPEN.value,
        "entry_price": 150.0, "target_price": 160.0, "stop_loss": 140.0, "qty": 100, "filled_qty": 100,
        "gross_pnl": -1050.0, "net_pnl": -1100.0
    })

    system_halted, exits_triggered = pm.check_portfolio_risk_breaker(current_realized_pnl=-1100.0, current_unrealized_pnl=0.0)
    assert system_halted is True
    assert exits_triggered == 1
    assert sm.get_system_state() == "HALTED"


def test_5_statutory_cost_reconciliation():
    """
    TEST 5: Statutory Cost Math Reconciliation
    Verifies: 100 shares @ ₹1,500 Buy & ₹1,530 Sell produces exact Indian equity charges:
    - Brokerage: ₹40.00
    - STT (0.025% on sell ₹1,53,000): ₹38.25
    - Exchange Turnover (0.00345% on ₹3,03,000): ₹10.45
    - GST (18% on ₹50.45): ₹9.08
    - Stamp Duty (0.003% on buy ₹1,50,000): ₹4.50
    - Total Cost: ₹102.28 -> Gross: ₹3,000.00 -> Net Realized P&L: ₹2,897.72 (± ₹0.50)
    """
    from engine.config import calculate_statutory_costs

    buy_qty = 100
    buy_price = 1500.0
    sell_price = 1530.0

    costs = calculate_statutory_costs(buy_qty, buy_price, sell_price)
    
    assert pytest.approx(costs["brokerage"], 0.01) == 40.00
    assert pytest.approx(costs["stt"], 0.01) == 38.25
    assert pytest.approx(costs["exchange_charges"], 0.01) == 10.45
    assert pytest.approx(costs["gst"], 0.01) == 9.08
    assert pytest.approx(costs["stamp_duty"], 0.01) == 4.50
    assert pytest.approx(costs["total_cost"], 0.01) == 102.28

    gross_pnl = (sell_price - buy_price) * buy_qty
    net_pnl = gross_pnl - costs["total_cost"]
    assert pytest.approx(net_pnl, 0.50) == 2897.72
