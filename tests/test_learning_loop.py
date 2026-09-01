import json
import uuid
from datetime import datetime, timezone
import pytest

from engine.store import MarketStore
from engine.forensic_review import run_eod_forensic_review, classify_trade_failure
from engine.intelligence import generate_premarket_shortlist


@pytest.fixture
def temp_store(tmp_path):
    db_file = tmp_path / "test_multibagger.db"
    store = MarketStore(str(db_file))
    return store


def test_1_losing_pattern_written_to_learning_store(temp_store):
    """Proves a losing trade is classified into 1 of 8 failure categories and written to learning_store."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO paper_trades (
                trade_id, trading_day, run_id, symbol, side, strategy, strategy_version,
                data_source, status, quantity, signal_entry, entry_quote, entry_fill,
                stop_price, target_price, opened_at, current_quote, last_marked_at,
                exit_quote, exit_fill, closed_at, exit_reason, gross_pnl, net_pnl,
                capital_used, intended_order_json
            ) VALUES (
                'T-001', ?, 'RUN-1', 'RELIANCE', 'LONG', 'Alpha (Balanced VWAP Pullback)', 'v1.0',
                'PAPER', 'CLOSED', 10, 2500.0, 2500.0, 2550.0, 2480.0, 2580.0, ?, 2450.0, ?,
                2450.0, 2450.0, ?, 'STOP_LOSS', -1000.0, -1000.0, 25500.0, '{"adx": 42.0, "rsi": 75.0}'
            )
        """, [day_str, now, now, now])

    summary = run_eod_forensic_review(temp_store, day_str)
    assert len(summary.failures_found) > 0

    with temp_store.connect() as con:
        lessons = con.execute("SELECT symbol, strategy_id, failure_category, penalty_score FROM learning_store").fetchall()
        assert len(lessons) > 0
        sym, strat, cat, penalty = lessons[0]
        assert sym == "RELIANCE"
        assert cat in [
            "stock selection", "late entry", "market/sector misalignment",
            "overextension/chasing", "weak volume quality", "wrong strategy template",
            "SL/target issue", "exit/thesis-failure handling"
        ]
        assert penalty >= 15.0


def test_2_premarket_shortlist_reads_lesson(temp_store):
    """Proves premarket shortlist pipeline reads past lessons from learning_store."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    lesson_id = f"LESSON-{uuid.uuid4().hex[:8].upper()}"
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO learning_store (
                lesson_id, trading_day, symbol, strategy_id, failure_category,
                penalty_score, reason, fresh_override_adx_threshold, fresh_override_rvol_threshold, created_at
            ) VALUES (?, ?, 'INFY', 'ANY', 'late entry', 20.0, 'Chased breakout', 30.0, 2.5, ?)
        """, [lesson_id, day_str, now])

    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["INFY"])
    assert len(shortlist) == 1
    item = shortlist[0]
    assert item["symbol"] == "INFY"
    assert item["yesterday_learning_adjustment"] < 0.0 or item["fresh_override_applied"]


def test_3_repeated_failed_condition_penalized_blocked(temp_store):
    """Proves a repeated failed stock x strategy condition receives a negative adjustment and is marked NO_TRADE."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    lesson_id = f"LESSON-{uuid.uuid4().hex[:8].upper()}"
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO learning_store (
                lesson_id, trading_day, symbol, strategy_id, failure_category,
                penalty_score, reason, fresh_override_adx_threshold, fresh_override_rvol_threshold, created_at
            ) VALUES (?, ?, 'TCS', 'ANY', 'wrong strategy template', 25.0, 'Failed in range bound', 30.0, 2.5, ?)
        """, [lesson_id, day_str, now])

    # Standard premarket indicators without high breakout ADX/RVOL
    indicators = {"TCS": {"adx": 22.0, "rvol": 1.2}}
    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["TCS"], live_indicators=indicators)
    assert len(shortlist) == 1
    item = shortlist[0]
    assert item["symbol"] == "TCS"
    assert item["yesterday_learning_adjustment"] <= -20.0
    assert item["status"] == "NO_TRADE"
    assert not item["fresh_override_applied"]


def test_4_valid_fresh_evidence_overrides_penalty(temp_store):
    """Proves valid fresh market evidence (ADX >= 30, RVOL >= 2.5) overrides yesterday's penalty."""
    now = datetime.now(timezone.utc)
    day_str = now.strftime("%Y-%m-%d")

    lesson_id = f"LESSON-{uuid.uuid4().hex[:8].upper()}"
    with temp_store.connect() as con:
        con.execute("""
            INSERT INTO learning_store (
                lesson_id, trading_day, symbol, strategy_id, failure_category,
                penalty_score, reason, fresh_override_adx_threshold, fresh_override_rvol_threshold, created_at
            ) VALUES (?, ?, 'HDFCBANK', 'ANY', 'weak volume quality', 15.0, 'Low volume', 30.0, 2.5, ?)
        """, [lesson_id, day_str, now])

    # Live market indicators showing fresh breakout evidence (ADX 32.5 >= 30, RVOL 2.8 >= 2.5)
    fresh_indicators = {"HDFCBANK": {"adx": 32.5, "rvol": 2.8}}
    shortlist = generate_premarket_shortlist(temp_store, universe_symbols=["HDFCBANK"], live_indicators=fresh_indicators)
    assert len(shortlist) == 1
    item = shortlist[0]
    assert item["symbol"] == "HDFCBANK"
    assert item["fresh_override_applied"] is True
    assert item["yesterday_learning_adjustment"] == 0.0
    assert item["status"] == "TRADE"


def test_5_shortlist_deterministic_and_strategy_locked(temp_store):
    """Proves premarket shortlist is deterministic across runs and locks 1 strategy per stock."""
    universe = ["RELIANCE", "INFY", "TCS", "HDFCBANK", "ICICIBANK"]
    
    run1 = generate_premarket_shortlist(temp_store, universe_symbols=universe)
    run2 = generate_premarket_shortlist(temp_store, universe_symbols=universe)

    assert len(run1) == len(universe)
    assert len(run2) == len(universe)

    # Confirm exact 1-to-1 match across runs (deterministic)
    for i in range(len(run1)):
        assert run1[i]["symbol"] == run2[i]["symbol"]
        assert run1[i]["strategy"] == run2[i]["strategy"]
        assert run1[i]["final_score"] == run2[i]["final_score"]
        assert run1[i]["status"] == run2[i]["status"]

    # Confirm 1 strategy per stock locked
    symbols_seen = set()
    for item in run1:
        assert item["symbol"] not in symbols_seen
        symbols_seen.add(item["symbol"])
