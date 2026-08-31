from __future__ import annotations

import os
import pytest
import datetime
from pathlib import Path

from engine.config import Settings, calculate_statutory_costs
from engine.state_machine import StateMachine, TradeState
from engine.gates import evaluate_candidate, calculate_adaptive_buy_limit, CandidateSetup
from engine.paper_engine import PaperExecutionEngine
from engine.position_manager import PositionManager
from engine.rejection_logger import DecisionLogger
from engine.notifier import send_telegram_alert, get_notifier_stats

@pytest.fixture(autouse=True)
def setup_certification_db(tmp_path, monkeypatch):
    cert_db = str(tmp_path / "certification_test.db")
    monkeypatch.setattr("engine.config.DB_PATH", cert_db)
    sm = StateMachine(db_path=cert_db)
    sm.init_db()
    yield cert_db

def test_kill_restart_certification(setup_certification_db):
    """TASK 17: Kill / Restart Certification Scenario Test."""
    db_path = setup_certification_db
    sm_phase1 = StateMachine(db_path=db_path)
    engine_phase1 = PaperExecutionEngine(db_path=db_path)

    # 1. Start & open simulated paper position
    t_id = "cert-kill-restart-001"
    sm_phase1.inject_raw_trade({
        "trade_id": t_id,
        "instrument_key": "NSE_EQ|INE002A01018",
        "symbol": "RELIANCE",
        "state": TradeState.OPEN.value,
        "entry_price": 2500.0,
        "target_price": 2560.0,
        "stop_loss": 2470.0,
        "qty": 20,
        "filled_qty": 20,
        "gross_pnl": 0.0,
        "net_pnl": 0.0,
    })

    # 2. Simulate process kill & restart
    sm_phase2 = StateMachine(db_path=db_path)
    reconciled = sm_phase2.reconcile_on_startup()
    pm_phase2 = PositionManager(db_path=db_path)
    engine_phase2 = PaperExecutionEngine(db_path=db_path)

    # 3. Verify state preserved and position tracked without duplication
    assert sm_phase2.get_state(t_id) == TradeState.OPEN
    active_pos = pm_phase2.get_active_positions()
    assert len(active_pos) == 1
    assert active_pos[0]["trade_id"] == t_id

    # 4. Resume supervisor and exit position
    exit_res = engine_phase2.execute_paper_exit(t_id, exit_price=2560.0, reason="TARGET_HIT")
    assert exit_res["status"] == "CLOSED"
    assert sm_phase2.get_state(t_id) == TradeState.CLOSED

    # 5. Confirm final state and P&L
    trade_rec = sm_phase2.get_trade(t_id)
    assert trade_rec["state"] == TradeState.CLOSED.value
    assert trade_rec["net_pnl"] > 0.0

def test_complete_synthetic_session_certification(setup_certification_db):
    """TASK 18: Complete Synthetic Session Certification Test."""
    db_path = setup_certification_db
    settings = Settings(db_path=Path(db_path))
    sm = StateMachine(db_path=db_path)
    engine = PaperExecutionEngine(db_path=db_path, settings=settings)
    pm = PositionManager(db_path=db_path, settings=settings)
    logger = DecisionLogger(settings=settings)

    # 1. Fresh market data -> candidate
    now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
    cand = CandidateSetup(
        symbol="TCS",
        instrument_key="NSE_EQ|INE467B01029",
        ltp=3500.0, bid=3499.5, ask=3500.5,
        tick_time=now_ts,
        upper_circuit=3850.0, atr_5m=12.0, atr_1m=4.0,
        entry_price=3500.0, target_price=3620.0, stop_loss=3460.0, qty=10,
        rvol=2.0, stock_return_pct=1.5, nifty500_return_pct=0.5, sector_return_pct=0.8,
        prior_day_delivery_pct=50.0, delivery_20d_sma=45.0,
        vwap=3495.0, ema20=3490.0, nifty500_15m_ret=0.2, current_open_risk=0.0
    )

    # 2. Evaluate gates
    passed, code, score = evaluate_candidate(cand, now_ts=now_ts)
    assert passed is True
    assert score >= 60

    # 3. Create TradeIntent & approve
    t_id = sm.create_trade_intent(cand.__dict__)
    assert sm.get_state(t_id) == TradeState.QUALIFIED
    sm.transition(t_id, TradeState.APPROVED)

    # 4. Paper order fill
    buy_limit = calculate_adaptive_buy_limit(cand.ask, cand.bid, cand.atr_1m, max_allowed_price=cand.upper_circuit)
    fill_res = engine.execute_paper_buy(t_id, cand.instrument_key, cand.qty, buy_limit, cand.ask)
    assert fill_res["status"] == "FILLED"
    assert sm.get_state(t_id) == TradeState.OPEN

    # 5. Position supervision & trailing SL
    pm.evaluate_trailing_sl(t_id, current_ltp=3530.0, high_since_entry=3535.0, atr_5m=12.0)

    # 6. Exit execution
    exit_res = engine.execute_paper_exit(t_id, exit_price=3570.0, reason="TARGET_HIT")
    assert exit_res["status"] == "CLOSED"
    assert sm.get_state(t_id) == TradeState.CLOSED

    # 7. Statutory cost calculation & P&L check
    costs = calculate_statutory_costs(cand.qty, cand.entry_price, 3570.0)
    assert costs["total_cost"] > 0.0

    # 8. EOD report & Telegram queue dispatch
    report = logger.generate_eod_report()
    assert report["trades_executed"] == 1
    assert report["net_realized_pnl"] > 0.0
    send_telegram_alert(f"📊 Synthetic Session Complete: Net P&L ₹{report['net_realized_pnl']:+.2f}")
